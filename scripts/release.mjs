import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

function pad2(n) {
  return String(n).padStart(2, '0');
}

export function formatLocalDateParts(date = new Date()) {
  const year = date.getFullYear();
  const month = date.getMonth() + 1;
  const day = date.getDate();
  return {
    year,
    month,
    day,
    isoDate: `${year}-${pad2(month)}-${pad2(day)}`,
    prefix: `${year}.${month}.${day}.`,
  };
}

function parseCalVerParts(versionStr) {
  if (typeof versionStr !== 'string') return null;
  const match = versionStr
    .trim()
    .replace(/^v/i, '')
    .replace(/-/g, '.')
    .match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
  if (!match) return null;
  return [Number(match[1]), Number(match[2]), Number(match[3]), Number(match[4])];
}

export function compareCalVer(a, b) {
  const partsA = Array.isArray(a) ? a : parseCalVerParts(a) ?? [0, 0, 0, 0];
  const partsB = Array.isArray(b) ? b : parseCalVerParts(b) ?? [0, 0, 0, 0];
  for (let i = 0; i < 4; i += 1) {
    if (partsA[i] > partsB[i]) return 1;
    if (partsA[i] < partsB[i]) return -1;
  }
  return 0;
}

function findMaxDailyForPrefix(changelogText, prefix) {
  const versionRegex = /^## \[(\d+)\.(\d+)\.(\d+)\.(\d+)\]/gm;
  let maxDaily = 0;
  let match;
  while ((match = versionRegex.exec(changelogText)) !== null) {
    const candidatePrefix = `${Number(match[1])}.${Number(match[2])}.${Number(match[3])}.`;
    if (candidatePrefix === prefix) {
      const daily = Number(match[4]);
      if (Number.isFinite(daily) && daily > maxDaily) {
        maxDaily = daily;
      }
    }
  }
  return maxDaily;
}

export function computeNextDailyVersion(changelogText, date = new Date(), currentManifestVersion = '') {
  let { year, month, day, prefix, isoDate } = formatLocalDateParts(date);
  let nextDaily = findMaxDailyForPrefix(changelogText, prefix) + 1;

  const manifestParts = parseCalVerParts(currentManifestVersion);
  if (manifestParts) {
    const [mYear, mMonth, mDay, mDaily] = manifestParts;
    const candidateParts = [year, month, day, nextDaily];
    if (compareCalVer(candidateParts, manifestParts) <= 0) {
      const dateCmp = compareCalVer([year, month, day, 0], [mYear, mMonth, mDay, 0]);
      if (dateCmp < 0) {
        year = mYear;
        month = mMonth;
        day = mDay;
        prefix = `${year}.${month}.${day}.`;
        isoDate = `${year}-${pad2(month)}-${pad2(day)}`;
        const changelogMaxOnManifestDate = findMaxDailyForPrefix(changelogText, prefix);
        nextDaily = Math.max(mDaily, changelogMaxOnManifestDate) + 1;
      } else {
        nextDaily = mDaily + 1;
      }
    }
  }

  return {
    version: `${prefix}${nextDaily}`,
    isoDate,
  };
}

function collectGitSubjectsSinceLastVersion() {
  try {
    const insideGit = execFileSync('git', ['rev-parse', '--is-inside-work-tree'], {
      stdio: ['ignore', 'pipe', 'ignore'],
      encoding: 'utf8',
    }).trim();
    if (insideGit !== 'true') return [];

    let range = 'HEAD';
    try {
      const lastTag = execFileSync('git', ['describe', '--tags', '--abbrev=0'], {
        stdio: ['ignore', 'pipe', 'ignore'],
        encoding: 'utf8',
      }).trim();
      if (lastTag) range = `${lastTag}..HEAD`;
    } catch {
      try {
        const lastReleaseSha = execFileSync(
          'git',
          ['log', '--grep=^chore(release):', '--pretty=format:%H', '-n', '1'],
          { stdio: ['ignore', 'pipe', 'ignore'], encoding: 'utf8' },
        ).trim();
        if (lastReleaseSha) range = `${lastReleaseSha}..HEAD`;
      } catch {
        // Fallback to recent HEAD history
      }
    }

    const log = execFileSync('git', ['log', range, '--pretty=format:%s', '-n', '30'], {
      stdio: ['ignore', 'pipe', 'ignore'],
      encoding: 'utf8',
    }).trim();
    if (!log) return [];

    return log
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.length > 0 && !line.startsWith('chore(release):'));
  } catch {
    return [];
  }
}

export function buildReleaseSection(version, isoDate, unreleasedBody, extraNotes = [], gitSubjects = []) {
  const trimmedBody = unreleasedBody.trim();
  const lines = [`## [${version}] - ${isoDate}`, ''];
  const formattedNotes = extraNotes
    .map((entry) => String(entry).trim())
    .filter((entry) => entry.length > 0)
    .map((entry) => `- ${entry.replace(/^-\s*/, '')}`);

  if (trimmedBody.length > 0) {
    if (formattedNotes.length === 0) {
      lines.push(trimmedBody);
    } else if (/^### Cambiado\b/m.test(trimmedBody)) {
      const cambiadoHeadingRe = /^### Cambiado\b[^\n]*$/m;
      const match = cambiadoHeadingRe.exec(trimmedBody);
      if (match) {
        const afterHeadingIdx = match.index + match[0].length;
        const rest = trimmedBody.slice(afterHeadingIdx);
        const nextSubheading = rest.match(/\n### /);
        const insertPos = nextSubheading
          ? afterHeadingIdx + nextSubheading.index
          : trimmedBody.length;
        const beforeInsert = trimmedBody.slice(0, insertPos).trimEnd();
        const afterInsert = trimmedBody.slice(insertPos);
        lines.push(`${beforeInsert}\n${formattedNotes.join('\n')}${afterInsert}`);
      } else {
        lines.push(trimmedBody, '', '### Cambiado', ...formattedNotes);
      }
    } else {
      lines.push(trimmedBody, '', '### Cambiado', ...formattedNotes);
    }
  } else {
    const entries = [
      ...formattedNotes,
      ...gitSubjects
        .map((entry) => String(entry).trim())
        .filter((entry) => entry.length > 0)
        .map((entry) => `- ${entry.replace(/^-\s*/, '')}`),
    ];
    if (entries.length === 0) {
      lines.push('### Cambiado', '- Actualización de mantenimiento y compilación.');
    } else {
      lines.push('### Cambiado', ...entries);
    }
  }

  return `${lines.join('\n')}\n`;
}

export function applyReleaseToChangelog(changelogText, version, isoDate, extraNotes = [], gitSubjects = []) {
  const unreleasedHeading = '## [Unreleased]';
  const idx = changelogText.indexOf(unreleasedHeading);
  if (idx === -1) {
    throw new Error('CHANGELOG.md must contain an "## [Unreleased]" heading.');
  }

  const afterHeadingStart = idx + unreleasedHeading.length;
  const rest = changelogText.slice(afterHeadingStart);
  const nextSectionMatch = rest.match(/\n## \[/);
  const nextSectionIdx = nextSectionMatch ? afterHeadingStart + nextSectionMatch.index + 1 : changelogText.length;

  const unreleasedBody = changelogText.slice(afterHeadingStart, nextSectionIdx);
  const releaseSection = buildReleaseSection(version, isoDate, unreleasedBody, extraNotes, gitSubjects);

  const before = changelogText.slice(0, afterHeadingStart);
  const after = changelogText.slice(nextSectionIdx);
  return `${before}\n\n${releaseSection}\n${after.replace(/^\n+/, '')}`;
}

function parseCliArgs(argv) {
  const notes = [];
  let dryRun = false;
  let buildAfter = false;

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--dry-run') {
      dryRun = true;
    } else if (arg === '--build') {
      buildAfter = true;
    } else if ((arg === '--note' || arg === '-m') && argv[i + 1]) {
      notes.push(argv[i + 1]);
      i += 1;
    }
  }

  return { notes, dryRun, buildAfter };
}

function readCurrentManifestVersion(root) {
  try {
    const manifestPath = path.join(root, 'extension', 'manifest.json');
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    return typeof manifest.version === 'string' ? manifest.version.trim() : '';
  } catch {
    return '';
  }
}

function updateProjectManifests(root, version) {
  const manifestPath = path.join(root, 'extension', 'manifest.json');
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  manifest.version = version;
  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');

  const pkgPath = path.join(root, 'package.json');
  const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
  const parts = version.split('.');
  pkg.version = `${parts[0]}.${parts[1]}.${parts[2]}-${parts[3]}`;
  fs.writeFileSync(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`, 'utf8');

  const swPath = path.join(root, 'pwa', 'sw.js');
  const swText = fs.readFileSync(swPath, 'utf8');
  const nextSw = swText.replace(/const CACHE_NAME = '[^']+';/, `const CACHE_NAME = 'prismamd-${version}';`);
  fs.writeFileSync(swPath, nextSw, 'utf8');
}

function main() {
  const root = process.cwd();
  const changelogPath = path.join(root, 'CHANGELOG.md');
  const changelogText = fs.readFileSync(changelogPath, 'utf8');
  const currentManifestVersion = readCurrentManifestVersion(root);

  const { notes, dryRun, buildAfter } = parseCliArgs(process.argv.slice(2));
  const { version, isoDate } = computeNextDailyVersion(changelogText, new Date(), currentManifestVersion);
  const gitSubjects = notes.length === 0 ? collectGitSubjectsSinceLastVersion() : [];
  const nextChangelog = applyReleaseToChangelog(changelogText, version, isoDate, notes, gitSubjects);

  if (dryRun) {
    console.log(`[dry-run] Next version: ${version} (${isoDate})`);
    console.log(nextChangelog.split('\n').slice(0, 30).join('\n'));
    return;
  }

  fs.writeFileSync(changelogPath, nextChangelog, 'utf8');
  updateProjectManifests(root, version);
  console.log(`Published release ${version} (${isoDate}) in CHANGELOG.md, extension/manifest.json, package.json and pwa/sw.js.`);

  if (buildAfter) {
    execFileSync('npm', ['run', 'build'], { stdio: 'inherit', cwd: root });
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
