#!/usr/bin/env node
const fs = require('fs');

// --- CLI PARSING ---
const args = process.argv.slice(2);
if (args.length < 2 || args.length > 4) {
  console.log('Usage: node ct_patch.js <name|index|address> <edited_raw.bin> [input_rom.rom] [output_rom.rom]');
  console.log('  name|index       : e.g., "Naga-Ette", "NPC-31", "87", "0x16C77E"');
  console.log('  edited_raw.bin   : Your edited sprite data');
  console.log('  input_rom.rom    : Source ROM (default: chrono.rom)');
  console.log('  output_rom.rom   : Patched ROM (default: chrono_patched.rom)');
  process.exit(0);
}

const targetInput = args[0];
const rawFile = args[1];
const romFile = args[2] || 'chrono.rom';
const outRomFile = args[3] || 'chrono_patched.rom';

// --- CSV & RESOLVER ---
function parseCSV(filePath) {
  const text = fs.readFileSync(filePath, 'utf8');
  const lines = text.trim().split(/\r?\n/);
  const headers = lines[0].split(',').map(h => h.trim().replace(/^"|"$/g, ''));
  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    if (!lines[i].trim()) continue;
    const matches = [];
    let curr = '', inQ = false;
    for (const ch of lines[i]) {
      if (ch === '"') inQ = !inQ;
      else if (ch === ',' && !inQ) { matches.push(curr.replace(/^"|"$/g, '').trim()); curr = ''; }
      else curr += ch;
    }
    matches.push(curr.replace(/^"|"$/g, '').trim());
    const obj = {};
    headers.forEach((h, idx) => obj[h] = matches[idx]);
    rows.push(obj);
  }
  return rows;
}

const indiciees = parseCSV('./ChronoTriggerUnheaderedSpriteInfo-indiciees.csv');
const packs = parseCSV('./ChronoTriggerUnheaderedSpriteInfo-gfx-packs.csv');

function resolveAddress(input) {
  const clean = input.replace(/\.bin$/i, '');
  if (/^0x[0-9a-fA-F]+$/.test(clean) || /^\d+$/.test(clean)) {
    return { address: parseInt(clean, clean.toLowerCase().startsWith('0x') ? 16 : 10), name: null };
  }
  const entry = indiciees.find(e =>
    e['Sprite Header Index']?.toLowerCase() === clean.toLowerCase() ||
    e['Character']?.toLowerCase() === clean.toLowerCase()
  );
  if (entry) {
    const gfxIdx = parseInt(entry['GFX Pack Pointer Index (Dec)']);
    const pack = packs.find(p => parseInt(p['GFX Pack Pointer Index (Dec)']) === gfxIdx);
    if (pack) {
      const addr = parseInt(pack['Sprite Packet Starting Address (Hex)'], 16);
      return { address: addr, name: entry['Character'] || entry['Sprite Header Index'] };
    }
  }
  const gfxIdx = parseInt(clean);
  if (!isNaN(gfxIdx)) {
    const pack = packs.find(p => parseInt(p['GFX Pack Pointer Index (Dec)']) === gfxIdx);
    if (pack) {
      const addr = parseInt(pack['Sprite Packet Starting Address (Hex)'], 16);
      return { address: addr, name: `GFX-${gfxIdx}` };
    }
  }
  return null;
}

// --- RECOMPRESSION ENGINE (Literal C# Translation) ---
function compressCT(src) {
  const SrcBuffer = src;
  const nSrcOff = 0;
  const nDecompressedSize = src.length;
  const WorkingBuffer = new Uint8Array(SrcBuffer.length + 0x20000);
  let nWorkOff = 0;

  let j, k, i;
  let nBitCtr;
  let nOffset;
  let nCopyLength;
  let nSrcPos;
  let nWorkPos;
  let nPackHdrOff;
  const CompData = [new Uint8Array(0x10000), new Uint8Array(0x10000)];
  let nCompSize = 0xFFFF;
  let nArrLength = 0;
  let nRange;
  let nMaxCopy;

  let bestData = null;
  let bestSize = 0xFFFF;

  for (i = 0; i < 2; i++) {
    nRange = (0x07FF | (i << 11));
    nMaxCopy = (18 + ((1 - i) << 4));
    nSrcPos = 1;
    nBitCtr = 1;
    nOffset = 0;
    nCopyLength = 0;
    nWorkPos = 4;
    nPackHdrOff = 2;
    CompData[i][3] = SrcBuffer[nSrcOff];

    while (nSrcPos < nDecompressedSize && nWorkPos < nCompSize) {
      for (; nBitCtr < 8 && nSrcPos < nDecompressedSize; nBitCtr++) {
        if (nSrcPos > nRange) {
          j = (nSrcPos - nRange);
        } else {
          j = 0;
        }
        for (; j < nSrcPos; j++) {
          for (k = 0; k < nMaxCopy && SrcBuffer[nSrcOff + j + k] === SrcBuffer[nSrcOff + nSrcPos + k]; k++) {}

          if (k >= nCopyLength) {
            nOffset = j;
            nCopyLength = k;
            if (k === nMaxCopy) break;
          }
        }
        if (nCopyLength > 2) {
          CompData[i][nPackHdrOff] |= (1 << nBitCtr);
          nOffset = (nSrcPos - nOffset);
          CompData[i][nWorkPos++] = (nOffset & 0xFF);
          CompData[i][nWorkPos++] = (((nCopyLength - 3) << (3 + i)) | ((nOffset >> 8) & (0x07 | (i << 3))));
          nSrcPos += nCopyLength;
          nCopyLength = 0;
        } else {
          CompData[i][nWorkPos++] = SrcBuffer[nSrcOff + nSrcPos++];
        }
      }
      if (nBitCtr === 8) {
        nBitCtr = 0;
        nPackHdrOff = nWorkPos;
        nWorkPos++;
      }
    }

    if (nWorkPos < nCompSize) {
      if (nBitCtr > 0) {
        CompData[i][nPackHdrOff] |= (0xFF << nBitCtr);
        for (let c = 0; c < nWorkPos - nPackHdrOff; c++) {
          CompData[i][nPackHdrOff + 3 + c] = CompData[i][nPackHdrOff + c];
        }
        CompData[i][nPackHdrOff] = (nBitCtr | (0xC0 * (i - 1)));
        nArrLength = (nWorkPos + 3);
        CompData[i][nPackHdrOff + 1] = nArrLength;
        CompData[i][nPackHdrOff + 2] = (nArrLength >> 8);
        CompData[i][nWorkPos + 3] = 0;
      } else {
        nArrLength = (nPackHdrOff + 1);
        CompData[i][nPackHdrOff] = (0xC0 * (i - 1));
      }

      nCompSize = (nPackHdrOff - 2);
      CompData[i][0] = (nCompSize & 0xFF);
      CompData[i][1] = (nCompSize >> 8);

      for (let c = 0; c <= nArrLength; c++) {
        WorkingBuffer[nWorkOff + c] = CompData[i][c];
      }

      if (nArrLength < bestSize) {
        bestSize = nArrLength;
        bestData = new Uint8Array(WorkingBuffer.slice(nWorkOff, nWorkOff + nArrLength + 1));
      }
    }
  }
  return bestData;
}

// --- MAIN EXECUTION ---
const rom = fs.readFileSync(romFile);
const raw = fs.readFileSync(rawFile);
const resolved = resolveAddress(targetInput);
if (!resolved) { console.error(`Error: Unknown target: ${targetInput}`); process.exit(1); }

const address = resolved.address;
const origSize = rom[address] | (rom[address + 1] << 8);
const totalPktSize = 2 + origSize + 1;

if (address + totalPktSize > rom.length) {
  console.error(`Error: Target packet exceeds ROM boundary.`);
  process.exit(1);
}

const compressedPacket = compressCT(raw);

console.log(`Original packet size: ${totalPktSize} bytes`);
console.log(`New packet size:      ${compressedPacket.length} bytes`);

if (compressedPacket.length !== totalPktSize) {
  console.error(`Error: Size mismatch. Expected ${totalPktSize}, got ${compressedPacket.length}.`);
  console.error('   Patching would overwrite adjacent ROM data. Simplify the sprite or use a ROM hole.');
  process.exit(1);
}

// Create a completely independent copy of the ROM to prevent memory aliasing corruption
const romOut = Buffer.allocUnsafe(rom.length);
rom.copy(romOut);

// Patch directly at the resolved address
romOut.set(compressedPacket, address);

fs.writeFileSync(outRomFile, romOut);
console.log(`Patched 0x${address.toString(16).toUpperCase()}`);
console.log(`Output: ${outRomFile}`);
