import fs from 'node:fs';
import path from 'node:path';
import { estimateTokens, toolText } from './context.js';
import { hash } from './util.js';
function read(file) { try { return fs.readFileSync(file, 'utf8'); } catch { return ''; } }
function json(file) { try { return JSON.parse(read(file)); } catch { return {}; } }
// Read only allowlisted scalar planning settings. Never execute config commands.
function codexConfig(raw, profile = null) {
    const values = {}; let section = '';
    for (const line of raw.split('\n')) {
        if (/^\s*\[/.test(line)) { section = line.trim(); continue; }
        if (section && section !== `[profiles.${profile}]`) continue;
        const match = line.match(/^\s*(model|profile|model_context_window|model_auto_compact_token_limit|model_auto_compact_token_limit_scope)\s*=\s*("[^"\n]*"|'[^'\n]*'|[\d_]+)\s*(?:#.*)?$/);
        if (match) values[match[1]] = /^\d/.test(match[2]) ? Number(match[2].replaceAll('_', '')) : match[2].slice(1, -1);
    }
    return values;
}
const positive = v => Number.isFinite(Number(v)) && Number(v) > 0 ? Number(v) : null;
export function activationInfo(store, native, branchId, cwd, env = process.env) {
    const branch = store.get('branch', branchId), parsed = store.parsed(branch.head, branch.agent), context = parsed.context;
    const target = typeof cwd === 'string' && path.isAbsolute(cwd) ? cwd : parsed.cwd;
    let model = context.model, window = null, compactAt = null, source = null;
    if (branch.agent === 'codex') {
        const root = native.roots.codex, raw = read(path.join(root, 'config.toml')), base = codexConfig(raw), profile = base.profile;
        const selected = profile && /^[\w.-]+$/.test(profile) ? codexConfig(read(path.join(root, profile + '.config.toml'))) : {};
        const config = { ...base, ...codexConfig(raw, profile), ...selected };
        model = config.model || model;
        window = positive(config.model_context_window);
        compactAt = config.model_auto_compact_token_limit_scope === 'body_after_prefix' ? null : positive(config.model_auto_compact_token_limit);
        if (window || compactAt) source = 'Codex config.toml';
        if (!window && model) {
            const models = json(path.join(root, 'models_cache.json')).models;
            const metadata = Array.isArray(models) && models.find(m => (m.slug || m.id) === model);
            if (metadata?.context_window) { window = positive(metadata.context_window); source = 'Codex model metadata'; }
        }
    } else {
        const config = [json(path.join(native.roots.claude, 'settings.json')), ...(target ? [json(path.join(target, '.claude', 'settings.json')), json(path.join(target, '.claude', 'settings.local.json'))] : [])].reduce((a, b) => ({ ...a, ...b, env: { ...a.env, ...b.env } }), {});
        model = config.model || model;
        const settings = { ...config.env };
        for (const key of ['CLAUDE_CODE_AUTO_COMPACT_WINDOW', 'CLAUDE_AUTOCOMPACT_PCT_OVERRIDE']) if (env[key]) settings[key] = env[key];
        const budget = positive(settings.CLAUDE_CODE_AUTO_COMPACT_WINDOW), pct = positive(settings.CLAUDE_AUTOCOMPACT_PCT_OVERRIDE);
        if (budget) { compactAt = budget * (pct && pct <= 100 ? pct / 100 : 1); source = 'Claude compaction configuration'; }
    }
    if (!window && context.lastUsage?.window && (!model || !context.model || model === context.model)) { window = context.lastUsage.window; source ||= 'Native context-window record'; }
    const disabled = new Set(branch.contextPolicy?.disabled || []);
    const usage = context.lastUsage, compact = context.compactions.filter(e => !disabled.has(e.id)).at(-1);
    const expanded = context.compactions.some(e => disabled.has(e.id) && (!compact || e.line > compact.line));
    let estimated = 0, basis = 'recorded-text';
    const estimateAfter = line => parsed.messages.filter(m => m.line > line).reduce((n, m) => n + estimateTokens(m.text), 0) + parsed.records.slice(line).reduce((n, r) => n + estimateTokens(toolText(r.value, branch.agent)), 0);
    if (expanded) { estimated = (compact ? estimateTokens(compact.summary || '') + compact.retained.reduce((n, m) => n + estimateTokens(m.text), 0) : 0) + estimateAfter(compact?.line || 0); basis = 'expanded-history-estimate'; }
    else if (usage && context.usageAfterCompaction && Number.isFinite(usage.input)) { estimated = usage.input + (usage.output || 0) + estimateAfter(usage.line); basis = 'last-native-request-plus-new-text'; }
    else if (compact) {
        estimated = estimateTokens(compact.summary || '') + compact.retained.reduce((n, m) => n + estimateTokens(m.text), 0) + estimateAfter(compact.line);
        basis = compact.opaque ? 'incomplete-after-compaction' : 'readable-compaction-plus-new-text';
    } else estimated = estimateAfter(0);
    const threshold = Math.min(window ? window * .8 : Infinity, compactAt || Infinity);
    const risk = Number.isFinite(threshold) && estimated >= threshold;
    const complete = parsed.complete && !parsed.errors.length && !parsed.warnings.some(w => w.includes('历史格式') || w.includes('外部附件'));
    const fingerprint = hash(JSON.stringify([branch.head, branch.contextPolicy, target, model, window, compactAt, estimated, basis]));
    return { model, window, compactAt, source, estimated, basis, risk, unknown: !window && !compactAt, complete, fingerprint, cwd: target || '', observedAt: usage?.at || null };
}
