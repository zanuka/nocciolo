export function matchGlob(pattern: string, relativePath: string): boolean {
  const raw = pattern.trim().split(/[/\\]/).join("/").replace(/^\.\//, "");
  const prefix = raw.endsWith("/");
  const pat = raw.replace(/\/+$/, "");
  const path = relativePath.split(/[/\\]/).join("/").replace(/^\.\//, "");
  if (!pat || !path || pat.split("/").includes("..") || path.split("/").includes("..")) {
    return false;
  }
  if (prefix) {
    return path === pat || path.startsWith(`${pat}/`);
  }
  return matchSegments(pat.split("/"), path.split("/"));
}

function matchSegments(pattern: string[], path: string[]): boolean {
  let patternIndex = 0;
  let pathIndex = 0;
  while (patternIndex < pattern.length && pathIndex < path.length) {
    const part = pattern[patternIndex];
    if (part === "**") {
      if (patternIndex === pattern.length - 1) {
        return true;
      }
      for (let skip = pathIndex; skip <= path.length; skip += 1) {
        if (matchSegments(pattern.slice(patternIndex + 1), path.slice(skip))) {
          return true;
        }
      }
      return false;
    }
    if (!matchSegment(part ?? "", path[pathIndex] ?? "")) {
      return false;
    }
    patternIndex += 1;
    pathIndex += 1;
  }
  while (patternIndex < pattern.length && pattern[patternIndex] === "**") {
    patternIndex += 1;
  }
  return patternIndex === pattern.length && pathIndex === path.length;
}

function matchSegment(pattern: string, segment: string): boolean {
  let regex = "";
  for (const char of pattern) {
    if (char === "*") {
      regex += ".*";
    } else if (char === "?") {
      regex += ".";
    } else {
      regex += char.replace(/[.+^${}()|[\]\\]/g, "\\$&");
    }
  }
  return new RegExp(`^${regex}$`).test(segment);
}
