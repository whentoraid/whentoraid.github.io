/**
 * A logger for one Edge Function: each failure is written to the function log and kept in
 * app_errors, where the owner sees it (docs/OPERATIONS.md). Recording never throws and never holds
 * up the response; the runtime is asked to finish it after the response has gone.
 * @param {{ rpc: (name: string, args: object) => PromiseLike<unknown> }} admin service-role client
 * @param {string} source the function's name
 * @returns {(message: string) => void}
 */
export function serverErrorReporter(admin, source, { waitUntil = globalThis.EdgeRuntime?.waitUntil } = {}) {
  return (message) => {
    const text = String(message)
    console.error(`${source}: ${text}`)
    const recorded = Promise.resolve()
      .then(() => admin.rpc('report_server_error', { p_source: source, p_message: text.slice(0, 500) }))
      .then(
        () => {},
        () => {},
      )
    waitUntil?.call(globalThis.EdgeRuntime, recorded)
  }
}
