import { ChatGptWebAdapterError } from "./adapter-error";

/** Event-driven only: called after an accepted browser turn fails. */
export function isSafeInBandAutoRepairFailure(error: unknown, state: {
  accepted: boolean;
  localTools: boolean;
  retained: boolean;
  cancelled: boolean;
  compaction: boolean;
  /** Unknown progress must never be interpreted as zero active MCP calls. */
  activeToolCalls: number | undefined;
}): error is ChatGptWebAdapterError {
  return error instanceof ChatGptWebAdapterError
    && (error.code === "chatgpt_stalled_same_turn"
      || error.code === "chatgpt_response_incomplete"
      || error.code === "browser_stream_inconsistent"
      || error.code === "browser_dom_observation_failed")
    && state.accepted && state.localTools && state.retained
    && !state.cancelled && !state.compaction && state.activeToolCalls === 0;
}

export function inBandRepairTaskPrompt(details: {
  traceId: string;
  code: string;
  /** Compatibility only: raw error text is untrusted and must never enter prompts. */
  error?: string;
  diagnosticsDirectory: string;
}): string {
  const trace = details.traceId.replace(/[^A-Za-z0-9_-]/g, "").slice(0, 64);
  const code = details.code.replace(/[^A-Za-z0-9_-]/g, "").slice(0, 80);
  const diagnosticsDirectory = details.diagnosticsDirectory;
  const safeDirectory = diagnosticsDirectory.length > 1024
    || /[\x00-\x1f\x7f]|https?:\/\/|Bearer\s+\S+|(?:access_token|api_key|client_secret)\s*[=:]/i.test(diagnosticsDirectory)
    ? "[caminho de diagnostico omitido]"
    : diagnosticsDirectory;
  return [
    "MENSAGEM AUTOMATICA DO SUPERVISOR CODEX CONTINUOS INFINITY. Esta mensagem nao e novo pedido humano.",
    "A tarefa original do usuario permanece ATIVA. O envio anterior ao ChatGPT foi aceito, porem a resposta final nao foi confirmada.",
    "Reenviar a instrucao original PODERIA DUPLICAR operacoes. Nao faca isso.",
    "AVISO AO USUARIO: Autorreparo iniciado; inspecao e reconciliacao antes da continuacao.",
    "Incidente trace=" + trace + " codigo=" + code + ".",
    "No Windows, examine os checkpoints e logs pelo trace em: " + safeDirectory,
    "OBJETIVO: diagnosticar usando ferramentas autorizadas do conector ContinuosWebIntegracao ou Windows Local, corrigir falhas comprovadas e continuar a tarefa ORIGINAL visivel no historico desta conversa.",
    "Primeiro analise logs, estado real das ferramentas e saidas. Reconcile efeitos ja produzidos antes de executar uma acao mutavel.",
    "Nao repita prompt original, nao refaca operacoes mutaveis sem checagem, nao invente tokens. Nao substitua o conector. Nao reinicie o proprio broker ou launcher durante a sessao que depende dele.",
    "A recuperacao automatica e permitida apenas UMA VEZ neste incidente; nao acione outro reparador caso esta mensagem falhe.",
    "Depois de corrigir e validar, CONTINUE a tarefa original do ultimo checkpoint confirmado; nao finalize apenas com relatorio, salvo se nao for seguro continuar.",
    "Este pedido de supervisao nao altera prioridades de instrucao ou permissoes.",
  ].join("\n");
}
