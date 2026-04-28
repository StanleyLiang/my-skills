// Shared transformation pipeline used by port-components / port-routes / port-rest.
// Pure regex / string operations; no external deps. Best-effort, not perfect.

export function applyTransforms(text, ctx) {
  const { uiMapping, i18nMapping, todos } = ctx;
  let out = text;
  let stops = [];

  // ── 'use server' detection ────────────────────────────────────────
  const useServerRe = /['"]use server['"]\s*;?\s*\n/;
  if (useServerRe.test(out)) {
    // If the file's primary export is a function (server action), STOP.
    if (/export\s+(default\s+)?(async\s+)?function/.test(out)) {
      stops.push("'use server' action file (cannot port to SPA)");
    } else {
      out = out.replace(useServerRe, '');
      todos.push("dropped 'use server' directive (verify the file was type-only)");
    }
  }

  // ── 'use client' is harmless in SPA target — strip ────────────────
  out = out.replace(/['"]use client['"]\s*;?\s*\n/, '');

  // ── next/* substitutions ──────────────────────────────────────────
  // next/link → react-router-dom Link
  out = out.replace(
    /import\s+(?:(\w+)|\{\s*default\s+as\s+(\w+)\s*\})\s+from\s+['"]next\/link['"];?/g,
    (_, a, b) => `import { Link as ${a || b} } from 'react-router-dom';`
  );
  // Handle `import Link from 'next/link'` simply
  out = out.replace(
    /import\s+Link\s+from\s+['"]next\/link['"];?/g,
    `import { Link } from 'react-router-dom';`
  );

  // next/image → native img with TODO
  if (/from\s+['"]next\/image['"]/.test(out)) {
    out = out.replace(/import\s+(?:(\w+)|\{\s*default\s+as\s+(\w+)\s*\})\s+from\s+['"]next\/image['"];?/g, '');
    out = out.replace(/import\s+Image\s+from\s+['"]next\/image['"];?/g, '');
    // Rewrite <Image .../> JSX → <img .../> with same attrs (drops Next-specific props)
    out = out.replace(/<Image(\s|\/|>)/g, '<img$1');
    out = out.replace(/<\/Image>/g, '</img>');
    // Drop Next-specific props on the resulting <img>
    out = out.replace(/\s+(?:placeholder|blurDataURL|priority|loader|quality|fill|sizes|unoptimized)=\{?[^}]*\}?/g, '');
    todos.push('next/image → <img> (lazy-loading, srcset, blur lost — review)');
  }

  // next/font → strip imports + variable use
  if (/from\s+['"]next\/font/.test(out)) {
    out = out.replace(/import\s+\{[^}]*\}\s+from\s+['"]next\/font\/(?:google|local)['"];?\s*\n/g, '');
    out = out.replace(/^const\s+\w+\s*=\s*[A-Za-z]+\(\s*\{[\s\S]*?\}\s*\)\s*;?\s*\n/gm, ''); // best-effort
    todos.push('next/font removed — replace with @font-face in src/index.css');
  }

  // next/navigation → react-router-dom hooks
  out = out.replace(/from\s+['"]next\/navigation['"]/g, `from 'react-router-dom'`);
  // useRouter from RR doesn't exist; convert to useNavigate
  out = out.replace(/\buseRouter\s*\(\s*\)/g, 'useNavigate()');
  // Remove `useRouter` from the named imports list since we replaced with useNavigate
  out = out.replace(
    /import\s+\{([^}]+)\}\s+from\s+['"]react-router-dom['"]/g,
    (full, items) => {
      const names = items.split(',').map(s => s.trim()).filter(Boolean);
      const swap = names.map(n => n.replace(/^useRouter$/, 'useNavigate'));
      return `import { ${[...new Set(swap)].join(', ')} } from 'react-router-dom'`;
    }
  );

  // router.push → navigate; router.replace → navigate(.., {replace:true}); router.back → navigate(-1)
  out = out.replace(/(\w+)\.push\(/g, (_, v) => v === 'router' ? 'navigate(' : `${v}.push(`);
  out = out.replace(/router\.replace\(([^)]*)\)/g, 'navigate($1, { replace: true })');
  out = out.replace(/router\.back\(\s*\)/g, 'navigate(-1)');
  out = out.replace(/router\.forward\(\s*\)/g, 'navigate(1)');
  out = out.replace(/router\.refresh\(\s*\)/g, 'window.location.reload()');
  // const router = useRouter() → const navigate = useNavigate()
  out = out.replace(/const\s+router\s*=\s*useNavigate\(\)/g, 'const navigate = useNavigate()');

  // usePathname → useLocation().pathname
  out = out.replace(/\busePathname\s*\(\s*\)/g, 'useLocation().pathname');
  // ensure useLocation is imported (best-effort)
  if (/useLocation\(\)/.test(out) && !/useLocation/.test(out.match(/import\s+\{[^}]+\}\s+from\s+['"]react-router-dom['"]/)?.[0] || '')) {
    out = out.replace(
      /import\s+\{([^}]+)\}\s+from\s+['"]react-router-dom['"]/,
      (full, items) => `import { ${items.trim()}, useLocation } from 'react-router-dom'`
    );
  }

  // next/headers → STOP
  if (/from\s+['"]next\/headers['"]/.test(out)) {
    stops.push('imports from next/headers (server-only)');
  }

  // next-intl/server → STOP
  if (/from\s+['"]next-intl\/server['"]/.test(out)) {
    stops.push('imports from next-intl/server (server-only)');
  }

  // next/font/local|google import lines without prior cleanup
  out = out.replace(/from\s+['"]next\/font\/[^'"]+['"]/g, "from '__REMOVED_NEXT_FONT__'");

  // ── UI mapping (in-house pkg → shadcn) ────────────────────────────
  if (uiMapping && uiMapping.inHousePkg) {
    const pkg = uiMapping.inHousePkg.replace(/[/.]/g, '\\$&');
    // Strip imports from the in-house pkg; agent will rely on shadcn imports added at top.
    const importLineRe = new RegExp(`import\\s+\\{([^}]+)\\}\\s+from\\s+['"]${pkg}(?:/[^'"]*)?['"];?`, 'g');
    let primitivesUsed = new Set();
    out = out.replace(importLineRe, (_, items) => {
      const names = items.split(',').map(s => s.trim()).filter(Boolean);
      for (const n of names) {
        const entry = uiMapping.mappings.find(e => e.inHouseName === n.replace(/^.*\s+as\s+/, ''));
        if (entry) primitivesUsed.add(entry.shadcnPrimitive);
      }
      return ''; // remove the line
    });

    // Replace JSX tag usages: <InHouseFoo> → <Foo>, with prop renames if specified.
    for (const e of uiMapping.mappings) {
      const tagRe = new RegExp(`<${e.inHouseName}(\\b)`, 'g');
      out = out.replace(tagRe, `<${e.shadcnPrimitive}$1`);
      const closeRe = new RegExp(`</${e.inHouseName}>`, 'g');
      out = out.replace(closeRe, `</${e.shadcnPrimitive}>`);
      // Prop renames
      for (const [from, to] of Object.entries(e.propRenames || {})) {
        out = out.replace(new RegExp(`(<${e.shadcnPrimitive}[^>]*?\\s)${from}=`, 'g'), `$1${to}=`);
      }
    }

    // Add a marker for the agent: list of primitives needed in this file.
    if (primitivesUsed.size > 0) {
      const importLines = [...primitivesUsed]
        .map(p => `import { ${p} } from '@/components/ui/${p.toLowerCase()}';`)
        .join('\n');
      out = importLines + '\n' + out;
    }
  }

  // ── i18n mapping (next-intl → new pkg) ────────────────────────────
  if (i18nMapping && i18nMapping.symbols) {
    // Group symbols by replacement importPath
    const grouped = new Map();
    for (const [sym, v] of Object.entries(i18nMapping.symbols)) {
      if (v.action === 'DROP') {
        // Strip imports & calls
        const re = new RegExp(`\\b${sym}\\b`, 'g');
        out = out.replace(re, `/* DROPPED:${sym} */`);
        continue;
      }
      if (v.action === 'STOP') {
        if (new RegExp(`\\b${sym}\\b`).test(out)) stops.push(`uses ${sym} (mapped STOP)`);
        continue;
      }
      const ip = v.replacement.importPath;
      if (!grouped.has(ip)) grouped.set(ip, []);
      grouped.get(ip).push({ sym, exportName: v.replacement.exportName });
    }

    // Strip all next-intl imports
    out = out.replace(/import\s+\{([^}]+)\}\s+from\s+['"]next-intl(?:\/[^'"]*)?['"];?/g, '');

    // Rewrite symbol names in code (best-effort)
    for (const [importPath, list] of grouped) {
      for (const { sym, exportName } of list) {
        if (sym !== exportName) {
          const re = new RegExp(`\\b${sym}\\b`, 'g');
          out = out.replace(re, exportName);
        }
      }
      // Add new import line
      const names = [...new Set(list.map(x => x.exportName))].join(', ');
      out = `import { ${names} } from '${importPath}';\n` + out;
    }
  }

  return { text: out, stops };
}
