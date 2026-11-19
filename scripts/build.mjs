#!/usr/bin/env node
// Builds dist/chrome, dist/firefox, and a zip of each from the shared src/
// files and the per-browser manifests. No dependencies; run with
// `node scripts/build.mjs`.
import {
  cpSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync
} from "node:fs";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { deflateRawSync } from "node:zlib";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const srcDir = join(root, "src");
const distDir = join(root, "dist");
const browsers = ["chrome", "firefox"];

function buildAll() {
  for (const browser of browsers) {
    const outDir = join(distDir, browser);

    // Rebuild from scratch so files deleted from src/ do not linger in dist/.
    rmSync(outDir, { recursive: true, force: true });
    mkdirSync(outDir, { recursive: true });

    for (const entry of readdirSync(srcDir)) {
      cpSync(join(srcDir, entry), join(outDir, entry), { recursive: true });
    }

    const manifestPath = join(root, "manifests", `${browser}.json`);
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
    writeFileSync(
      join(outDir, "manifest.json"),
      JSON.stringify(manifest, null, 2) + "\n"
    );

    const zipPath = join(
      distDir,
      `web-clipper-for-super-productivity-${browser}-v${manifest.version}.zip`
    );
    writeZip(zipPath, outDir);

    console.log(`built dist/${browser}`);
    console.log(`built ${basename(zipPath)}`);
  }
}

// Minimal ZIP writer: deflate entries, no directory entries, fixed timestamps
// so repeated builds of the same input produce the same archive.
function writeZip(zipPath, dir) {
  const chunks = [];
  const central = [];
  let offset = 0;
  const files = listFiles(dir);
  // 1980-01-01 00:00:00, the earliest DOS timestamp.
  const dosTime = 0;
  const dosDate = (0 << 9) | (1 << 5) | 1;

  for (const file of files) {
    const name = Buffer.from(file.path, "utf8");
    const data = readFileSync(join(dir, file.path));
    const compressed = deflateRawSync(data, { level: 9 });
    const checksum = crc32(data);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0); // local file header
    local.writeUInt16LE(20, 4); // version needed to extract
    local.writeUInt16LE(0x0800, 6); // UTF-8 file name
    local.writeUInt16LE(8, 8); // deflate
    local.writeUInt16LE(dosTime, 10);
    local.writeUInt16LE(dosDate, 12);
    local.writeUInt32LE(checksum, 14);
    local.writeUInt32LE(compressed.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(name.length, 26);
    chunks.push(local, name, compressed);

    const header = Buffer.alloc(46);
    header.writeUInt32LE(0x02014b50, 0); // central directory header
    header.writeUInt16LE(20, 4); // version made by
    header.writeUInt16LE(20, 6); // version needed to extract
    header.writeUInt16LE(0x0800, 8); // UTF-8 file name
    header.writeUInt16LE(8, 10); // deflate
    header.writeUInt16LE(dosTime, 12);
    header.writeUInt16LE(dosDate, 14);
    header.writeUInt32LE(checksum, 16);
    header.writeUInt32LE(compressed.length, 20);
    header.writeUInt32LE(data.length, 24);
    header.writeUInt16LE(name.length, 28);
    header.writeUInt32LE(offset, 42);
    central.push(header, name);

    offset += local.length + name.length + compressed.length;
  }

  const centralBuffer = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); // end of central directory
  end.writeUInt16LE(files.length, 8); // entries on this disk
  end.writeUInt16LE(files.length, 10); // total entries
  end.writeUInt32LE(centralBuffer.length, 12);
  end.writeUInt32LE(offset, 16);

  writeFileSync(zipPath, Buffer.concat([...chunks, centralBuffer, end]));
}

// Recursively lists files as posix-style relative paths, sorted for stable
// archive output.
function listFiles(dir, prefix = "") {
  const files = [];

  const entries = readdirSync(dir, { withFileTypes: true })
    .sort((a, b) => a.name.localeCompare(b.name));

  for (const entry of entries) {
    const path = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      files.push(...listFiles(join(dir, entry.name), path));
    } else {
      files.push({ path });
    }
  }

  return files;
}

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let i = 0; i < 256; i += 1) {
    let value = i;
    for (let bit = 0; bit < 8; bit += 1) {
      value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    }
    table[i] = value;
  }
  return table;
})();

function crc32(buffer) {
  let crc = -1;
  for (const byte of buffer) {
    crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ -1) >>> 0;
}

buildAll();
