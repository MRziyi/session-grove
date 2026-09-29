import { hash } from './util.js';
// Paths reference shared message bodies on the wire. Record locations remain
// path-specific, so opening tool records still addresses the correct revision.
export function packGraph(graph) {
    const messagePool = {}, paths = graph.paths.map(p => ({ ...p, messages: p.messages.map(m => {
        const { line, ...body } = m, ref = hash(JSON.stringify(body));
        messagePool[ref] ||= body;
        return { ref, line };
    }) }));
    return { ...graph, paths, messagePool, format: 'shared-messages-v1' };
}
