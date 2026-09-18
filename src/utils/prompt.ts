import { createInterface } from "node:readline";

export function isInteractive(stdin: NodeJS.ReadStream = process.stdin): boolean {
  return Boolean(stdin.isTTY);
}

export async function promptLine(
  question: string,
  options: {
    defaultValue?: string;
    stdin?: NodeJS.ReadStream;
    stdout?: NodeJS.WritableStream;
  } = {},
): Promise<string> {
  const stdin = options.stdin ?? process.stdin;
  const stdout = options.stdout ?? process.stdout;
  const suffix =
    options.defaultValue !== undefined && options.defaultValue.length > 0
      ? ` [${options.defaultValue}]`
      : "";

  const rl = createInterface({ input: stdin, output: stdout });
  try {
    const answer = await new Promise<string>((resolve) => {
      rl.question(`${question}${suffix}: `, (line) => {
        resolve(line);
      });
    });
    const trimmed = answer.trim();
    if (trimmed.length === 0 && options.defaultValue !== undefined) {
      return options.defaultValue;
    }
    return trimmed;
  } finally {
    rl.close();
  }
}

/**
 * Line-based multi-select: prints numbered choices, reads one line of
 * comma-separated indices (or "all" / "none"). No TUI dependency, so it
 * works over a plain pipe in tests and CI-adjacent terminals.
 */
export async function promptMultiSelect(
  question: string,
  choices: string[],
  options: {
    stdin?: NodeJS.ReadStream;
    stdout?: NodeJS.WritableStream;
  } = {},
): Promise<string[]> {
  const stdin = options.stdin ?? process.stdin;
  const stdout = options.stdout ?? process.stdout;

  if (choices.length === 0) {
    return [];
  }

  stdout.write(`${question}\n`);
  choices.forEach((choice, index) => {
    stdout.write(`  ${index + 1}) ${choice}\n`);
  });

  const answer = await promptLine(
    'Select by number (comma-separated), "all", or blank for none',
    { stdin, stdout },
  );
  const trimmed = answer.trim().toLowerCase();
  if (trimmed === "" || trimmed === "none") {
    return [];
  }
  if (trimmed === "all") {
    return [...choices];
  }

  const selected = new Set<string>();
  for (const part of trimmed.split(",")) {
    const n = Number.parseInt(part.trim(), 10);
    if (Number.isInteger(n) && n >= 1 && n <= choices.length) {
      const choice = choices[n - 1];
      if (choice !== undefined) {
        selected.add(choice);
      }
    }
  }
  return choices.filter((c) => selected.has(c));
}
