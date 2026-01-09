#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { program } = require('commander');
const { create } = require('xmlbuilder2');

// --- 1. CLI Setup ---
program
  .version('1.0.0')
  .description('Convert PlantUML Gitflow (Sequence) diagrams to Draw.io XML')
  .argument('<inputFile>', 'Path to the .puml file')
  .option('-o, --output <path>', 'Output file path')
  .action((inputFile, options) => {
    const outputPath = options.output || inputFile.replace(/\.puml$|\.txt$/, '.drawio');
    convert(inputFile, outputPath);
  });

program.parse(process.argv);

// --- 2. The Converter Core ---
function convert(inputFile, outputPath) {
  console.log(`\n🌱 Reading ${inputFile}...`);
  
  try {
    const content = fs.readFileSync(inputFile, 'utf-8');
    const model = parsePlantUML(content);
    console.log(`   Found ${model.branches.size} branches and ${model.events.length} events.`);
    
    const xml = generateDrawioXml(model);
    
    fs.writeFileSync(outputPath, xml);
    console.log(`✅ Successfully created: ${outputPath}\n`);
  } catch (err) {
    console.error(`❌ Error: ${err.message}`);
    process.exit(1);
  }
}

// --- 3. Parsing Logic (Regex based) ---
function parsePlantUML(content) {
  const lines = content.split(/\r?\n/);
  const branches = new Map(); // Name -> { id, yIndex, lastNodeId, xPos }
  const events = []; // { type: 'commit'|'merge', from, to, label }

  let branchCounter = 0;

  lines.forEach(line => {
    line = line.trim();
    if (!line || line.startsWith("'") || line.startsWith("@")) return;

    // 3a. Parse Participants (Branches)
    // format: participant "Master" as M
    const partMatch = line.match(/participant\s+"?([^"]+)"?(\s+as\s+(\w+))?/i);
    if (partMatch) {
      const name = partMatch[1];
      const alias = partMatch[3] || name;
      if (!branches.has(alias)) {
        branches.set(alias, { 
          id: alias, 
          name: name, 
          yIndex: branchCounter++, 
          lastNodeId: null,
          xPos: 0 
        });
      }
      return;
    }

    // 3b. Parse Commits (Notes)
    // format: note over M : Initial Commit or hnote over M : v1.0
    const noteMatch = line.match(/(note|hnote)\s+over\s+(\w+)\s*:\s*(.*)/i);
    if (noteMatch) {
      const branchAlias = noteMatch[2];
      const label = noteMatch[3];
      if (branches.has(branchAlias)) {
        events.push({ type: 'commit', branch: branchAlias, label });
      }
      return;
    }

    // 3c. Parse Merges/Flows (Arrows)
    // format: M -> D : Branch off
    const arrowMatch = line.match(/(\w+)\s*->\s*(\w+)\s*(?::\s*(.*))?/);
    if (arrowMatch) {
      const from = arrowMatch[1];
      const to = arrowMatch[2];
      const label = arrowMatch[3] || '';
      
      // Auto-register branches if not defined
      [from, to].forEach(b => {
        if (!branches.has(b)) {
           branches.set(b, { id: b, name: b, yIndex: branchCounter++, lastNodeId: null, xPos: 0 });
        }
      });

      events.push({ type: 'merge', from, to, label });
    }
  });

  return { branches, events };
}

// --- 4. Draw.io XML Generator ---
function generateDrawioXml(model) {
  const root = create({ version: '1.0', encoding: 'UTF-8' })
    .ele('mxfile', { host: 'Electron', type: 'device' })
    .ele('diagram', { name: 'Gitflow' })
    .ele('mxGraphModel', { dx: '1000', dy: '1000', grid: '1', gridSize: '10', guides: '1', tooltips: '1', connect: '1', arrows: '1', fold: '1', page: '1', pageScale: '1', pageWidth: '827', pageHeight: '1169', math: '0', shadow: '0' })
    .ele('root');

  root.ele('mxCell', { id: '0' });
  root.ele('mxCell', { id: '1', parent: '0' });

  // CONSTANTS for Layout
  const SPACING_X = 120;
  const SPACING_Y = 100;
  const START_X = 40;
  const START_Y = 40;

  // Track current X position per branch
  const globalX = { val: START_X };
  
  // 4a. Draw Branch "Swimlanes" (Horizontal Lines)
  model.branches.forEach((branch) => {
    const y = START_Y + (branch.yIndex * SPACING_Y);
    
    // Draw Label for Branch
    root.ele('mxCell', {
      id: `label_${branch.id}`,
      value: branch.name,
      style: 'text;html=1;strokeColor=none;fillColor=none;align=center;verticalAlign=middle;whiteSpace=wrap;rounded=0;fontStyle=1',
      vertex: '1',
      parent: '1'
    }).ele('mxGeometry', { x: '10', y: y - 10, width: '60', height: '30', as: 'geometry' });

    // We don't draw the full line yet, we let the commits define the path
  });

  let idCounter = 100;

  // 4b. Process Events to create Nodes and Edges
  model.events.forEach(event => {
    globalX.val += SPACING_X; // Move time forward

    if (event.type === 'commit') {
      const branch = model.branches.get(event.branch);
      const nodeId = `node_${idCounter++}`;
      const x = globalX.val;
      const y = START_Y + (branch.yIndex * SPACING_Y);

      // Create Commit Circle
      root.ele('mxCell', {
        id: nodeId,
        value: '', // Commits usually empty dots, label goes separate or inside
        style: 'ellipse;whiteSpace=wrap;html=1;aspect=fixed;fillColor=#f5f5f5;strokeColor=#333333;strokeWidth=2;',
        vertex: '1',
        parent: '1'
      }).ele('mxGeometry', { x: x, y: y, width: '20', height: '20', as: 'geometry' });

      // Label the commit
      if (event.label) {
        root.ele('mxCell', {
          id: `txt_${nodeId}`,
          value: event.label,
          style: 'text;html=1;align=center;verticalAlign=middle;resizable=0;points=[];autosize=1;strokeColor=none;fillColor=none;',
          vertex: '1',
          parent: '1'
        }).ele('mxGeometry', { x: x - 20, y: y - 25, width: '60', height: '20', as: 'geometry' });
      }

      // Link to previous node on this branch (The "Git Line")
      if (branch.lastNodeId) {
        root.ele('mxCell', {
          id: `edge_${idCounter++}`,
          value: '',
          style: 'endArrow=none;html=1;rounded=0;strokeWidth=2;',
          edge: '1',
          parent: '1',
          source: branch.lastNodeId,
          target: nodeId
        }).ele('mxGeometry', { relative: '1', as: 'geometry' });
      }

      branch.lastNodeId = nodeId;
      branch.xPos = x;
    }

    if (event.type === 'merge') {
      const fromBranch = model.branches.get(event.from);
      const toBranch = model.branches.get(event.to);
      
      // We need a node on the TARGET branch to accept the merge
      const mergeNodeId = `node_${idCounter++}`;
      const x = globalX.val;
      const y = START_Y + (toBranch.yIndex * SPACING_Y);

      // Create Merge Node on Target
      root.ele('mxCell', {
        id: mergeNodeId,
        value: '',
        style: 'ellipse;whiteSpace=wrap;html=1;aspect=fixed;fillColor=#dae8fc;strokeColor=#6c8ebf;strokeWidth=2;',
        vertex: '1',
        parent: '1'
      }).ele('mxGeometry', { x: x, y: y, width: '20', height: '20', as: 'geometry' });

      // Connect Target Branch Line
      if (toBranch.lastNodeId) {
        root.ele('mxCell', {
          id: `edge_${idCounter++}`,
          value: '',
          style: 'endArrow=none;html=1;rounded=0;strokeWidth=2;',
          edge: '1',
          parent: '1',
          source: toBranch.lastNodeId,
          target: mergeNodeId
        }).ele('mxGeometry', { relative: '1', as: 'geometry' });
      }

      // Connect Merge Arrow (From Source Last Node -> To New Merge Node)
      if (fromBranch.lastNodeId) {
        root.ele('mxCell', {
          id: `edge_${idCounter++}`,
          value: event.label,
          style: 'endArrow=classic;html=1;rounded=0;strokeWidth=1;dashed=1;', // Dashed for merge usually
          edge: '1',
          parent: '1',
          source: fromBranch.lastNodeId,
          target: mergeNodeId
        }).ele('mxGeometry', { relative: '1', as: 'geometry' });
      }

      toBranch.lastNodeId = mergeNodeId;
      toBranch.xPos = x;
    }
  });

  return root.end({ prettyPrint: true });
}