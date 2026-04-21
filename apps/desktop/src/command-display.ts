function isShellProgram(program: string): boolean {
  const normalized = program.replace(/\\/g, "/");
  const base = normalized.slice(normalized.lastIndexOf("/") + 1).toLowerCase();
  return base === "bash" || base === "zsh" || base === "sh";
}

/**
 * Temporary shim until Codex app-server exposes structured argv or a
 * display-specific command field for command execution items/approvals.
 */
export function codexDisplayCommand(command: string): string | undefined {
  const argv: string[] = [];
  let current = "";
  let quote: "'" | '"' | null = null;

  for (let i = 0; i < command.length; i += 1) {
    const char = command[i];

    if (quote === "'") {
      if (char === "'") quote = null;
      else current += char;
      continue;
    }

    if (quote === '"') {
      if (char === '"') {
        quote = null;
        continue;
      }
      if (char === "\\") {
        const next = command[i + 1];
        if (next === undefined) return undefined;
        if (next === '"' || next === "\\" || next === "$" || next === "`" || next === "\n") {
          current += next === "\n" ? "" : next;
          i += 1;
          continue;
        }
      }
      current += char;
      continue;
    }

    if (/\s/.test(char)) {
      if (current) {
        argv.push(current);
        current = "";
        if (argv.length > 3) return undefined;
      }
      continue;
    }

    if (char === "'" || char === '"') {
      quote = char;
      continue;
    }

    if (char === "\\") {
      const next = command[i + 1];
      if (next === undefined) return undefined;
      current += next === "\n" ? "" : next;
      i += 1;
      continue;
    }

    current += char;
  }

  if (quote !== null) return undefined;
  if (current) argv.push(current);
  if (argv.length !== 3) return undefined;

  const [program, flag, script] = argv;
  if ((flag !== "-lc" && flag !== "-c") || !isShellProgram(program)) return undefined;
  return script;
}
