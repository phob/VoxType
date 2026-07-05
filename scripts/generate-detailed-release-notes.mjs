#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import process from "node:process";

const usage = `Usage: node scripts/generate-detailed-release-notes.mjs <tag> [options]

Generates GitHub Release notes from merged PR metadata and each PR's
"## Release Notes" section. PRs without detailed notes fall back to the
standard generated PR-title bullet.

Options:
  --target <ref>        Target commit/ref for the release. Defaults to <tag> if it exists locally, otherwise main.
  --previous-tag <tag>  Previous release tag. Defaults to the tag before <tag>, or the latest local tag.
  --output <path>       Output markdown path. Defaults to RELEASE_NOTES.md.
  --repo <owner/name>   GitHub repository. Defaults to GITHUB_REPOSITORY or origin remote.

Examples:
  node scripts/generate-detailed-release-notes.mjs v0.3.9
  node scripts/generate-detailed-release-notes.mjs v0.3.9 --target main --output RELEASE_NOTES.md`;

const defaultOutputPath = "RELEASE_NOTES.md";
const releaseNotesHeadingPattern = /^##\s+Release Notes\s*$/im;
const sectionHeadingPattern = /^###\s+(.+?)\s*$/gm;
const changelogLinePattern = /\*\*Full Changelog\*\*: .+/;
const releaseNoteBoilerplateLines = new Set([
  "Use user-facing wording for changes that should appear in the public changelog.",
  "The release workflow copies this section into detailed GitHub Release notes.",
  "Group bullets under optional `### Added`, `### Fixed`, `### Improved`, `### Changed`,",
  "`### Documentation`, or `### Internal Changes` headings when that makes the notes clearer."
]);

const orderedSectionTitles = [
  "Added",
  "Fixed",
  "Improved",
  "Changed",
  "Documentation",
  "Internal Changes",
  "Other Changes"
];

const categoryRules = [
  { title: "Added", labels: ["feature", "enhancement"] },
  { title: "Fixed", labels: ["bug", "fix"] },
  { title: "Improved", labels: ["improvement", "performance", "ui", "ux"] },
  { title: "Documentation", labels: ["documentation"] },
  { title: "Internal Changes", labels: ["build", "ci", "dependencies", "refactor"] }
];

function parseArgs(argv) {
  const options = {
    outputPath: defaultOutputPath,
    previousTag: null,
    repo: process.env.GITHUB_REPOSITORY ?? null,
    tag: null,
    target: null
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === "--help" || arg === "-h") {
      console.log(usage);
      process.exit(0);
    }

    if (arg === "--target") {
      options.target = readOptionValue(argv, (index += 1), arg);
      continue;
    }

    if (arg === "--previous-tag") {
      options.previousTag = normalizeTag(readOptionValue(argv, (index += 1), arg));
      continue;
    }

    if (arg === "--output") {
      options.outputPath = readOptionValue(argv, (index += 1), arg);
      continue;
    }

    if (arg === "--repo") {
      options.repo = readOptionValue(argv, (index += 1), arg);
      continue;
    }

    if (arg.startsWith("-")) {
      throw new Error(`Unknown option: ${arg}`);
    }

    if (options.tag) {
      throw new Error(`Unexpected extra argument: ${arg}`);
    }

    options.tag = normalizeTag(arg);
  }

  options.tag = options.tag ?? normalizeTag(process.env.RELEASE_TAG ?? "");

  if (!options.tag) {
    throw new Error("A release tag is required.");
  }

  options.repo = options.repo ?? readRepoFromOrigin();
  options.target = options.target ?? defaultTargetForTag(options.tag);
  options.previousTag = options.previousTag ?? defaultPreviousTag(options.tag);

  if (!options.repo) {
    throw new Error("Could not determine GitHub repository. Pass --repo owner/name.");
  }

  return options;
}

function readOptionValue(argv, index, optionName) {
  const value = argv[index];

  if (!value || value.startsWith("-")) {
    throw new Error(`${optionName} requires a value.`);
  }

  return value;
}

function normalizeTag(value) {
  const trimmed = value.trim();

  if (!trimmed) {
    return "";
  }

  return trimmed.startsWith("v") ? trimmed : `v${trimmed}`;
}

function run(command, args, options = {}) {
  return execFileSync(command, args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    ...options
  }).trim();
}

function tryRun(command, args) {
  try {
    return run(command, args);
  } catch {
    return null;
  }
}

function readRepoFromOrigin() {
  const remoteUrl = tryRun("git", ["remote", "get-url", "origin"]);

  if (!remoteUrl) {
    return null;
  }

  const httpsMatch = remoteUrl.match(/github\.com[:/](?<owner>[^/]+)\/(?<name>[^/.]+)(?:\.git)?$/i);

  if (!httpsMatch?.groups) {
    return null;
  }

  return `${httpsMatch.groups.owner}/${httpsMatch.groups.name}`;
}

function defaultTargetForTag(tag) {
  return gitRefExists(tag) ? tag : "main";
}

function defaultPreviousTag(tag) {
  if (gitRefExists(tag)) {
    const tagBeforeCurrent = tryRun("git", ["describe", "--tags", "--abbrev=0", `${tag}^`]);

    if (tagBeforeCurrent) {
      return tagBeforeCurrent;
    }
  }

  const latestTag = tryRun("git", ["describe", "--tags", "--abbrev=0"]);

  if (!latestTag) {
    throw new Error("Could not determine previous release tag. Pass --previous-tag.");
  }

  return latestTag;
}

function gitRefExists(ref) {
  return tryRun("git", ["rev-parse", "--verify", "--quiet", ref]) !== null;
}

function readToken() {
  const envToken = process.env.GH_TOKEN ?? process.env.GITHUB_TOKEN;

  if (envToken) {
    return envToken;
  }

  return tryRun("gh", ["auth", "token"]);
}

async function githubJson(repo, path, options = {}) {
  const token = readToken();

  if (!token) {
    throw new Error("GitHub token required. Set GH_TOKEN/GITHUB_TOKEN or authenticate gh.");
  }

  const url = new URL(`https://api.github.com/repos/${repo}/${path}`);
  const response = await fetch(url, {
    ...options,
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "User-Agent": "voxtype-release-notes",
      "X-GitHub-Api-Version": "2022-11-28",
      ...(options.headers ?? {})
    }
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`GitHub API ${response.status} for ${url.pathname}: ${body}`);
  }

  return response.json();
}

async function generateGitHubNotes({ repo, tag, target, previousTag }) {
  return githubJson(repo, "releases/generate-notes", {
    body: JSON.stringify({
      tag_name: tag,
      target_commitish: target,
      previous_tag_name: previousTag
    }),
    method: "POST"
  });
}

async function compareCommits({ repo, previousTag, target }) {
  const encodedBase = encodeURIComponent(previousTag);
  const encodedHead = encodeURIComponent(target);
  const compare = await githubJson(repo, `compare/${encodedBase}...${encodedHead}`);

  return Array.isArray(compare.commits) ? compare.commits : [];
}

async function listPullRequestsForCommits(repo, commits) {
  const seenNumbers = new Set();
  const pullRequests = [];

  for (const commit of commits) {
    const sha = commit.sha;

    if (!sha) {
      continue;
    }

    const associatedPulls = await githubJson(repo, `commits/${sha}/pulls`);

    for (const pull of associatedPulls) {
      if (seenNumbers.has(pull.number)) {
        continue;
      }

      seenNumbers.add(pull.number);
      pullRequests.push(await hydratePullRequest(repo, pull.number));
    }
  }

  return pullRequests
    .filter((pull) => pull.merged_at)
    .filter((pull) => !isExcludedPullRequest(pull))
    .sort((first, second) => new Date(first.merged_at).getTime() - new Date(second.merged_at).getTime());
}

async function hydratePullRequest(repo, number) {
  const [pull, issue] = await Promise.all([
    githubJson(repo, `pulls/${number}`),
    githubJson(repo, `issues/${number}`)
  ]);

  return {
    body: pull.body ?? "",
    html_url: pull.html_url,
    labels: (issue.labels ?? []).map((label) => label.name).filter(Boolean),
    merged_at: pull.merged_at,
    number: pull.number,
    title: pull.title,
    user: pull.user
  };
}

function isExcludedPullRequest(pull) {
  const labels = new Set(pull.labels.map((label) => label.toLowerCase()));
  return labels.has("skip-changelog") || pull.user?.login === "github-actions[bot]";
}

function categoryForPullRequest(pull) {
  const labels = new Set(pull.labels.map((label) => label.toLowerCase()));
  const rule = categoryRules.find((item) => item.labels.some((label) => labels.has(label)));

  return rule?.title ?? "Other Changes";
}

function extractReleaseNotes(body) {
  const headingMatch = body.match(releaseNotesHeadingPattern);

  if (!headingMatch || headingMatch.index === undefined) {
    return "";
  }

  const contentStart = headingMatch.index + headingMatch[0].length;
  const remainder = body.slice(contentStart);
  const nextMajorHeading = remainder.search(/^##\s+/m);
  const content = nextMajorHeading === -1 ? remainder : remainder.slice(0, nextMajorHeading);

  return stripReleaseNoteBoilerplate(content.replace(/<!--[\s\S]*?-->/g, "")).trim();
}

function stripReleaseNoteBoilerplate(markdown) {
  return markdown
    .replace(/\r\n/g, "\n")
    .split("\n")
    .filter((line) => !releaseNoteBoilerplateLines.has(line.trim()))
    .join("\n");
}

function releaseNoteSectionsForPullRequest(pull) {
  const releaseNotes = extractReleaseNotes(pull.body);

  if (!hasUsefulReleaseNotes(releaseNotes)) {
    return [
      {
        items: [`${pull.title} by @${pull.user?.login ?? "unknown"} in ${pull.html_url}`],
        title: categoryForPullRequest(pull)
      }
    ];
  }

  return parseReleaseNoteSections(releaseNotes, categoryForPullRequest(pull)).map((section) => ({
    items: section.items.map((item) => appendPullRequestReference(item, pull)),
    title: normalizeSectionTitle(section.title)
  }));
}

function hasUsefulReleaseNotes(markdown) {
  const withoutHeadings = markdown
    .replace(sectionHeadingPattern, "")
    .replace(/^\s*[-*]\s*$/gm, "")
    .trim();

  return withoutHeadings.length > 0;
}

function parseReleaseNoteSections(markdown, fallbackTitle) {
  const matches = [...markdown.matchAll(sectionHeadingPattern)];

  if (!matches.length) {
    return [{ items: markdownItems(markdown), title: fallbackTitle }];
  }

  const sections = [];
  const preface = markdown.slice(0, matches[0].index).trim();

  if (hasUsefulReleaseNotes(preface)) {
    sections.push({ items: markdownItems(preface), title: fallbackTitle });
  }

  for (let index = 0; index < matches.length; index += 1) {
    const match = matches[index];
    const nextMatch = matches[index + 1];
    const title = match[1].trim();
    const contentStart = match.index + match[0].length;
    const contentEnd = nextMatch?.index ?? markdown.length;
    const items = markdownItems(markdown.slice(contentStart, contentEnd));

    if (items.length) {
      sections.push({ items, title });
    }
  }

  return sections;
}

function markdownItems(markdown) {
  const lines = markdown.replace(/\r\n/g, "\n").split("\n");
  const items = [];
  let paragraph = [];

  function flushParagraph() {
    const text = paragraph.join(" ").replace(/\s+/g, " ").trim();

    if (text && text !== "-") {
      items.push(text);
    }

    paragraph = [];
  }

  for (const line of lines) {
    const trimmed = line.trim();

    if (!trimmed) {
      flushParagraph();
      continue;
    }

    if (/^#{1,6}\s+/.test(trimmed)) {
      flushParagraph();
      continue;
    }

    const bulletMatch = trimmed.match(/^[-*]\s+(?<text>.+)$/) ?? trimmed.match(/^\d+[.)]\s+(?<text>.+)$/);

    if (bulletMatch?.groups?.text) {
      flushParagraph();
      items.push(bulletMatch.groups.text.trim());
      continue;
    }

    paragraph.push(trimmed);
  }

  flushParagraph();

  return items.filter(Boolean);
}

function normalizeSectionTitle(title) {
  const normalized = title.trim().replace(/:$/, "");
  const knownTitle = orderedSectionTitles.find(
    (item) => item.toLowerCase() === normalized.toLowerCase()
  );

  return knownTitle ?? normalized;
}

function appendPullRequestReference(item, pull) {
  if (item.includes(pull.html_url) || item.includes(`#${pull.number}`)) {
    return item;
  }

  return `${item} ([#${pull.number}](${pull.html_url}))`;
}

function addSectionItem(sections, title, item) {
  if (!sections.has(title)) {
    sections.set(title, []);
  }

  sections.get(title).push(item);
}

function leadingHtmlComment(markdown) {
  const match = markdown.match(/^(<!--[\s\S]*?-->\s*)+/);
  return match?.[0].trim() ?? null;
}

function fullChangelogLine(markdown) {
  return markdown.match(changelogLinePattern)?.[0] ?? null;
}

function generatedFooterSections(markdown) {
  const fullChangelogMatch = markdown.match(changelogLinePattern);
  const contentBeforeChangelog =
    fullChangelogMatch?.index === undefined
      ? markdown
      : markdown.slice(0, fullChangelogMatch.index);
  const newContributorsIndex = contentBeforeChangelog.search(/^##\s+New Contributors\s*$/m);

  if (newContributorsIndex === -1) {
    return null;
  }

  return contentBeforeChangelog.slice(newContributorsIndex).trim();
}

function renderReleaseNotes({ generatedBody, pullRequests }) {
  const sections = new Map();

  for (const pull of pullRequests) {
    for (const section of releaseNoteSectionsForPullRequest(pull)) {
      for (const item of section.items) {
        addSectionItem(sections, section.title, item);
      }
    }
  }

  if (!sections.size) {
    return generatedBody.trim();
  }

  const lines = [];
  const comment = leadingHtmlComment(generatedBody);
  const footerSections = generatedFooterSections(generatedBody);
  const changelogLine = fullChangelogLine(generatedBody);

  if (comment) {
    lines.push(comment, "");
  }

  lines.push("## What's Changed", "");

  for (const sectionTitle of orderedSectionTitles) {
    const items = sections.get(sectionTitle);

    if (!items?.length) {
      continue;
    }

    lines.push(`### ${sectionTitle}`);
    lines.push(...items.map((item) => `* ${item}`));
    lines.push("");
    sections.delete(sectionTitle);
  }

  for (const [sectionTitle, items] of sections) {
    lines.push(`### ${sectionTitle}`);
    lines.push(...items.map((item) => `* ${item}`));
    lines.push("");
  }

  if (footerSections) {
    lines.push(footerSections, "");
  }

  if (changelogLine) {
    lines.push(changelogLine);
  }

  return `${lines.join("\n").trim()}\n`;
}

try {
  const options = parseArgs(process.argv.slice(2));
  const [generatedNotes, commits] = await Promise.all([
    generateGitHubNotes(options),
    compareCommits(options)
  ]);
  const pullRequests = await listPullRequestsForCommits(options.repo, commits);
  const releaseNotes = renderReleaseNotes({
    generatedBody: generatedNotes.body,
    pullRequests
  });

  writeFileSync(options.outputPath, releaseNotes, "utf8");
  console.log(
    `Wrote ${options.outputPath} from ${pullRequests.length} pull request(s) between ${options.previousTag} and ${options.target}.`
  );
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  console.error("");
  console.error(usage);
  process.exit(1);
}
