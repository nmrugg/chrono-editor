#!/usr/bin/env node
const fs = require('fs');

// --- CLI PARSING ---
const args = process.argv.slice(2);
const listFlag = args.includes('--list');
const romFile = args.find(a => /\.(?:rom|sfc|smc|bin)$/i.test(a)) || 'chrono.rom';
const targetInput = args.find(a => !/\.(?:rom|sfc|smc|bin)$/i.test(a) && a !== '--list');

if (!targetInput && !listFlag) {
  console.log('Usage: node ct_decompress.js [--list] <name|index|address> [rom.rom]');
  console.log('  --list           : Show all available sprite names & indices');
  console.log('  name|index       : e.g., "Naga-Ette", "NPC-31", "87", "0x16C77E"');
  console.log('  rom.rom          : Unheadered ROM (default: chrono.rom)');
  process.exit(0);
}

// --- CSV PARSER ---
function parseCSV(filePath) {
  if (!fs.existsSync(filePath)) {
    console.error(`Error: Missing CSV: ${filePath}`);
    process.exit(1);
  }
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

// --- ADDRESS RESOLVER ---
function resolveAddress(input) {
  if (/^0x[0-9a-fA-F]+$/.test(input) || /^\d+$/.test(input)) {
    return { address: parseInt(input, input.toLowerCase().startsWith('0x') ? 16 : 10), name: null };
  }
  const entry = indiciees.find(e =>
    e['Sprite Header Index']?.toLowerCase() === input.toLowerCase() ||
    e['Character']?.toLowerCase() === input.toLowerCase()
  );
  if (entry) {
    const gfxIdx = parseInt(entry['GFX Pack Pointer Index (Dec)']);
    const pack = packs.find(p => parseInt(p['GFX Pack Pointer Index (Dec)']) === gfxIdx);
    if (pack) {
      const addr = parseInt(pack['Sprite Packet Starting Address (Hex)'], 16);
      return { address: addr, name: entry['Character'] || entry['Sprite Header Index'] };
    }
  }
  const gfxIdx = parseInt(input);
  if (!isNaN(gfxIdx)) {
    const pack = packs.find(p => parseInt(p['GFX Pack Pointer Index (Dec)']) === gfxIdx);
    if (pack) {
      const addr = parseInt(pack['Sprite Packet Starting Address (Hex)'], 16);
      return { address: addr, name: `GFX-${gfxIdx}` };
    }
  }
  return null;
}

// --- DECOMPRESSION ENGINE (Literal C# Translation) ---
function decompressCT(rom, nStartAddr) {
  const WorkingBuffer = new Uint8Array(0x20000);
  let bCarryFlag = false;
  let nCompressedSize = rom[nStartAddr] | (rom[nStartAddr + 1] << 8);
  let nBytePos = nStartAddr + 2;
  let nByteAfter = nBytePos + nCompressedSize;
  let nBitCtr;
  let nCurByte;
  let nMem0D = 0;
  let nWorkPos = 0;
  let bSmallerBitWidth = false;

  if ((rom[nByteAfter] & 0xC0) !== 0) {
    bSmallerBitWidth = true;
  }

  nBitCtr = 8;
  
  while (true) {
    if (nBytePos === nByteAfter) {
      nCurByte = rom[nBytePos];
      nCurByte &= 0x3F;
      if (nCurByte === 0) {
        return WorkingBuffer.slice(0, nWorkPos);
      }
      nBitCtr = nCurByte;
      bCarryFlag = false;
      nByteAfter = nStartAddr + ((rom[nBytePos + 2] << 8) | rom[nBytePos + 1]);
      nBytePos += 3;
    } else {
      nCurByte = rom[nBytePos];
      if (nCurByte === 0) {
        WorkingBuffer[nWorkPos++] = rom[nBytePos + 1];
        WorkingBuffer[nWorkPos++] = rom[nBytePos + 2];
        WorkingBuffer[nWorkPos++] = rom[nBytePos + 3];
        WorkingBuffer[nWorkPos++] = rom[nBytePos + 4];
        WorkingBuffer[nWorkPos++] = rom[nBytePos + 5];
        WorkingBuffer[nWorkPos++] = rom[nBytePos + 6];
        WorkingBuffer[nWorkPos++] = rom[nBytePos + 7];
        WorkingBuffer[nWorkPos++] = rom[nBytePos + 8];
        bCarryFlag = false;
        nBytePos += 9;
      } else {
        nBytePos++;
        if ((nCurByte & 0x01) === 1) {
          bCarryFlag = true;
        } else {
          bCarryFlag = false;
        }
        nCurByte >>= 1;
        nMem0D = nCurByte;

        if (bCarryFlag) {
          let nBytesCopyNum = rom[nBytePos + 1];
          if (bSmallerBitWidth) {
            nBytesCopyNum >>= 3;
          } else {
            nBytesCopyNum >>= 4;
          }
          nBytesCopyNum += 2;
          let nBytesCopyOff = (rom[nBytePos + 1] << 8) | rom[nBytePos];
          if (bSmallerBitWidth) {
            nBytesCopyOff &= 0x07FF;
          } else {
            nBytesCopyOff &= 0x0FFF;
          }
          for (let i = 0; i < nBytesCopyNum + 1; i++) {
            WorkingBuffer[nWorkPos + i] = WorkingBuffer[nWorkPos - nBytesCopyOff + i];
          }
          nWorkPos += (nBytesCopyNum + 1);
          nBytePos += 2;
        } else {
          WorkingBuffer[nWorkPos++] = rom[nBytePos];
          nBytePos++;
        }

        while (true) {
          nBitCtr--;
          if (nBitCtr === 0) {
            nBitCtr = 8;
            break;
          } else {
            if ((nMem0D & 0x01) === 1) {
              bCarryFlag = true;
            } else {
              bCarryFlag = false;
            }
            nMem0D >>= 1;
            if (bCarryFlag) {
              let nBytesCopyNum = rom[nBytePos + 1];
              if (bSmallerBitWidth) {
                nBytesCopyNum >>= 3;
              } else {
                nBytesCopyNum >>= 4;
              }
              nBytesCopyNum += 2;
              let nBytesCopyOff = (rom[nBytePos + 1] << 8) | rom[nBytePos];
              if (bSmallerBitWidth) {
                nBytesCopyOff &= 0x07FF;
              } else {
                nBytesCopyOff &= 0x0FFF;
              }
              for (let i = 0; i < nBytesCopyNum + 1; i++) {
                WorkingBuffer[nWorkPos + i] = WorkingBuffer[nWorkPos - nBytesCopyOff + i];
              }
              nWorkPos += (nBytesCopyNum + 1);
              nBytePos += 2;
            } else {
              WorkingBuffer[nWorkPos++] = rom[nBytePos];
              nBytePos++;
            }
          }
        }
      }
    }
  }
}

// --- MAIN EXECUTION ---
if (listFlag) {
  console.log('Available Sprites:');
  console.log('-'.repeat(80));
  indiciees.forEach(e => {
    const gfx = e['GFX Pack Pointer Index (Dec)'];
    const pack = packs.find(p => parseInt(p['GFX Pack Pointer Index (Dec)']) === parseInt(gfx));
    const addr = pack ? pack['Sprite Packet Starting Address (Hex)'] : 'N/A';
    const name = e['Character'] || e['Sprite Header Index'];
    console.log(`${e['Sprite Header Index'].padEnd(12)} | ${name.padEnd(45)} | GFX: ${gfx} | Addr: 0x${addr}`);
  });
  process.exit(0);
}

const rom = fs.readFileSync(romFile);
const resolved = resolveAddress(targetInput);
if (!resolved) { console.error(`Error: Unknown target: ${targetInput}`); process.exit(1); }

const raw = decompressCT(rom, resolved.address);
const safeName = (resolved.name || `addr_${resolved.address.toString(16).toUpperCase()}`).replace(/[/\\:]/g, '_');
const outFile = `${safeName}.bin`;

fs.writeFileSync(outFile, raw);
console.log(`Decompressed: ${safeName}`);
console.log(`Address: 0x${resolved.address.toString(16).toUpperCase()}`);
console.log(`Size: ${raw.length} bytes -> ${outFile}`);
