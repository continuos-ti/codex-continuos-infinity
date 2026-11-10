import { afterEach, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ChatGptWebAdapterError } from "../src/adapters/chatgpt-web/adapter-error";
import { ChatGptBrowserWorker } from "../src/adapters/chatgpt-web/browser-worker";
import { LAUNCHER_BROWSER_IDLE_URL, LAUNCHER_BROWSER_HOST_KIND } from "../src/launcher-browser-host";

const paths: string[] = [];
afterEach(() => { for (const root of paths.splice(0)) rmSync(root, { recursive: true, force: true }); });

async function fixture(stub: (turn: any, reused: boolean, call: number) => Promise<string>, endReply: Record<string, unknown> = {}) {
  const root = mkdtempSync(join(tmpdir(), "codex-runexclusive-repair-"));
  paths.push(root);
  const requests: Array<{ phase?: string; status?: string }> = [];
  const server = Bun.serve({
    hostname: "127.0.0.1", port: 0,
    async fetch(request) {
      const body = await request.json() as {phase?: string;status?: string};
      requests.push(body);
      if (body.phase === "start") return Response.json({
        ok: true, surfaceId: "launcher_surface_id_0123456789AB", reused: false, connectorBound: true,
      });
      return Response.json({ ok: true, cancelledByUser: false, ...(body.phase === "end" ? endReply : {}) });
    },
  });
  writeFileSync(join(root,"dummy-helper.cjs"), "process.exit(99);", {mode:0o700});
  const descriptorPath = join(root, "launcher.json");
  writeFileSync(descriptorPath, JSON.stringify({
    version: 3, kind: LAUNCHER_BROWSER_HOST_KIND, profile: "production", pid: process.pid,
    endpoint: "http://127.0.0.1:" + server.port,
    control: {endpoint:"http://127.0.0.1:" + server.port,token:"launcher-control-token-0123456789abcdefghijklmnop"},
    helper: {executable:process.execPath,script:join(root,"dummy-helper.cjs")},
    partition:"persist:codex-web-gpt-chatgpt",idleUrl:LAUNCHER_BROWSER_IDLE_URL,
    surfaceId:"launcher_surface_id_0123456789AB",
    surfaceTargets:{launcher_surface_id_0123456789AB:"native-owned-target"},
    createdAt:new Date().toISOString(),
  }));
  let count = 0;
  const worker = Object.assign(Object.create(ChatGptBrowserWorker.prototype), {
    config: {browserHost:"launcher", browserHostDescriptorPath:descriptorPath, appName:"ContinuosWebIntegracao"},
    runBrowserTurn: async (turn: any, surfaceId: string, _unused: unknown, reused: boolean) => {
      expect(surfaceId).toBe("launcher_surface_id_0123456789AB");
      count += 1;
      return stub(turn, reused, count);
    },
  }) as any;
  return {worker,requests,server,root,count:()=>count};
}

function turn(extra: Record<string, unknown> = {}) {
  const observed: string[] = [];
  const comments: string[] = [];
  const base = {
    traceId:"test-recovery-trace",modelId:"gpt-5.6-sol",
    capabilities:{localToolsEnabled:true,solAvailable:true,extraHighAvailable:true,proAvailable:true},
    conversationKey:"a".repeat(64),retainConversation:true,
    prepare:async()=>({text:"DO NOT RESEND",images:[],release(){}}),
    prepareRecovery:async()=>({text:"NEW REPAIR ONLY",images:[],turnToken:"turn_0123456789abcdef0123456789abcdef",release(){}}),
    onTextDelta:(delta:string)=>observed.push(delta),
    onCommentary:(note:string)=>comments.push(note),
    externalProgress:{snapshot:()=>({revision:1,lastToolBatchRevision:0,activeToolCalls:0})},
    completionFence:{begin:async()=>1,commit:async()=>true},
    ...extra,
  };
  return {base,observed,comments};
}

test("accepted stall uses one recovery turn on same surface and returns original+repair text",async()=>{
  const f = await fixture(async (request,reused,count)=>{
    if(count===1) {
      expect(reused).toBe(false);
      await request.onSubmitted?.();
      request.onTextDelta?.("partial ");
      throw new ChatGptWebAdapterError("No final after same-turn observation recovery",{
        code:"chatgpt_stalled_same_turn",status:503,errorType:"server_error",retryable:false,
      });
    }
    expect(reused).toBe(true);
    expect((await request.prepareResume()).text).toBe("NEW REPAIR ONLY");
    request.onTextDelta?.("completed");
    return "completed";
  });
  try{
    const t=turn({traceId:"aa11bb22cc33",incidentJournalDirectory:join(f.root,"runtime-incidents")});
    const result=await f.worker.runExclusive(t.base);
    expect(result).toBe("partial completed");
    expect(t.observed).toEqual(["partial ","completed"]);
    expect(t.comments.join(" ")).toContain("Codex Continuos Infinity");
    expect(t.comments.join(" ")).toContain("retomando a tarefa original");
    expect(f.count()).toBe(2);
    expect(f.requests.filter(x=>x.phase==="start").length).toBe(1);
    expect(f.requests.filter(x=>x.phase==="end").length).toBe(1);
    expect(JSON.parse(await Bun.file(join(f.root,"runtime-incidents","aa11bb22cc33.json")).text()))
      .toMatchObject({phase:"after_submission", classification:"response_stalled",
        outcome:"inband_response_completed", autoRepairAttempts:1, priorToolEffects:"unknown"});
  }finally{await f.server.stop(true)}
});

test("stalled turn with active MCP work fails closed without re-sending",async()=>{
  const f=await fixture(async (request,_reuse,count)=>{
    if(count===1){
      await request.onSubmitted?.();
      throw new ChatGptWebAdapterError("No final",{
        code:"chatgpt_stalled_same_turn",status:503,errorType:"server_error",retryable:false,
      });
    }
    return "must not run";
  });
  try{
    const t=turn({traceId:"ab12cd34ef56",incidentJournalDirectory:join(f.root,"runtime-incidents"),
      externalProgress:{snapshot:()=>({revision:2,lastToolBatchRevision:2,activeToolCalls:1})}});
    await expect(f.worker.runExclusive(t.base)).rejects.toThrow("No final");
    expect(f.count()).toBe(1);
    expect(JSON.parse(await Bun.file(join(f.root,"runtime-incidents","ab12cd34ef56.json")).text()))
      .toMatchObject({outcome:"failed",activeToolCallsObserved:1, autoRepairAttempts:0});
  }finally{await f.server.stop(true)}
});

test("authentication failure after acceptance is journaled without attempting recovery",async()=>{
  const f=await fixture(async request=>{
    await request.onSubmitted?.();
    throw new ChatGptWebAdapterError("Private OAuth details",{
      code:"chatgpt_sign_in_required",status:401,errorType:"authentication_error",retryable:false,
    });
  });
  try {
    const t=turn({traceId:"bb22cc33dd44",incidentJournalDirectory:join(f.root,"runtime-incidents")});
    await expect(f.worker.runExclusive(t.base)).rejects.toThrow("Private OAuth details");
    expect(f.count()).toBe(1);
    const text=await Bun.file(join(f.root,"runtime-incidents","bb22cc33dd44.json")).text();
    expect(JSON.parse(text)).toMatchObject({classification:"authentication_or_session",
      phase:"after_submission",outcome:"failed",autoRepairAttempts:0});
    expect(text).not.toContain("OAuth");
  } finally {await f.server.stop(true)}
});

test("send activation without accepted acknowledgement is journaled as uncertain and not repeated",async()=>{
  const f=await fixture(async request=>{
    await request.onSendActivated?.();
    throw new Error("Browser transport closed with sensitive connection URL");
  });
  try {
    const t=turn({traceId:"cc33dd44ee55",incidentJournalDirectory:join(f.root,"runtime-incidents")});
    await expect(f.worker.runExclusive(t.base)).rejects.toThrow("Browser transport closed");
    expect(f.count()).toBe(1);
    const text=await Bun.file(join(f.root,"runtime-incidents","cc33dd44ee55.json")).text();
    expect(JSON.parse(text)).toMatchObject({classification:"unclassified_browser_failure",
      phase:"send_activated",currentAttemptSubmitted:false,priorSubmissionState:"unknown",
      priorToolEffects:"unknown",activeToolCallsObserved:0});
    expect(text).not.toContain("sensitive");
  } finally {await f.server.stop(true)}
});

test("successful repair is not journaled as recovered if launcher release requires authentication",async()=>{
  const f=await fixture(async (request,_reused,count)=>{
    await request.onSubmitted?.();
    if(count===1) throw new ChatGptWebAdapterError("No final",{
      code:"chatgpt_response_incomplete",status:502,errorType:"server_error",retryable:false,
    });
    return "repair response visible";
  },{authenticationRequired:true});
  try {
    const t=turn({traceId:"dd44ee55ff66",incidentJournalDirectory:join(f.root,"runtime-incidents")});
    await expect(f.worker.runExclusive(t.base)).rejects.toThrow("ChatGPT requested sign-in");
    expect(f.count()).toBe(2);
    const incident=JSON.parse(await Bun.file(join(f.root,"runtime-incidents","dd44ee55ff66.json")).text());
    expect(incident).toMatchObject({outcome:"failed", classification:"authentication_or_session",
      autoRepairAttempts:1, recovery:"await_authoritative_reconciliation"});
  } finally {await f.server.stop(true)}
});
