/* ContextBranch webview client */
(function () {
  'use strict';

  // Verify the VS Code API is available — defensive check
  if (typeof acquireVsCodeApi !== 'function') {
    document.body.innerHTML = '<div style="padding:20px;color:red">' +
      '<strong>VS Code API not available</strong>. The webview CSP may be blocking it. ' +
      'Open the webview developer tools to inspect.</div>';
    return;
  }

  const vscode = acquireVsCodeApi();
  const $ = (id) => document.getElementById(id);

  // ─── state ────────────────────────────────────────────────────────────

  let state = {
    condition: 'branched',
    providerReady: false,
    activeBranchId: null,
    mainBranchId: null,
    branches: [],
    messages: [],
    activeBranchName: '',
    activeBranchStatus: '',
    isMain: true,
    telemetry: null,
    isStreaming: false,
    streamingText: '',
    decompositionResult: null,
    pendingMergePreview: null,
    pendingMerge: null,
    historyOpen: false,
    historyGraph: null,
    selectedHistoryNodeId: null,
  };

  window.__cb = {
  get state() { return state; },
  get send()  { return send; },
  $: $,
  };
  // ─── messaging ────────────────────────────────────────────────────────

  function send(msg) {
    try { vscode.postMessage(msg); }
    catch (e) { showStatus('Failed to send message: ' + e.message, 'error'); }
  }

  window.addEventListener('message', (e) => {
    const msg = e.data;
    try {
      switch (msg.type) {
        case 'state': handleState(msg); break;
        case 'streamStart': handleStreamStart(); break;
        case 'streamDelta': handleStreamDelta(msg.text); break;
        case 'streamAborted': handleStreamAborted(); break;
        case 'streamEnd': handleStreamEnd(); break;
        case 'error':
          showStatus(msg.message, 'error');
          // Reset transient UI states so we never get stuck spinners
          $('merge-running').hidden = true;
          handleStreamEnd();
          break;
        case 'success': showStatus(msg.message, 'success'); break;
        case 'decompositionResult': handleDecompositionResult(msg.result); break;
        case 'mergePreview': handleMergePreview(msg.preview, msg.sourceBranchId, msg.targetBranchId); break;
        case 'mergeCompleted': handleMergeCompleted(msg.event, msg.cascadingApplied, msg.conflictsResolved); break;
        case 'switchApplied': {
          const parts = [];
          if (msg.wrote) parts.push(`wrote ${msg.wrote}`);
          if (msg.removed) parts.push(`removed ${msg.removed}`);
          showStatus(`Switched to ${msg.branchName} — ${parts.join(', ')} files on disk.`, 'info');
          break;
        }
      }
    } catch (err) {
      showStatus('UI error: ' + err.message, 'error');
    }
  });

  // ─── handlers ─────────────────────────────────────────────────────────

  function handleState(s) {
    state = Object.assign({}, state, s);
    render();
    if (state.historyOpen && state.historyGraph) {
      renderHistoryView();
    }
  }

  function handleStreamStart() {
    state.isStreaming = true;
    state.streamingText = '';
    $('btn-send').hidden = true;
    $('btn-stop').hidden = false;
    $('streaming').hidden = false;
    $('streaming-text').textContent = '';
    $('composer-status').textContent = 'Generating...';
    scrollToBottom();
  }

  function handleStreamDelta(text) {
    state.streamingText += text;
    $('streaming-text').textContent = state.streamingText;
    scrollToBottom();
  }

  function handleStreamAborted() {
    showStatus('Generation stopped.', 'info');
    handleStreamEnd();
  }

  function handleStreamEnd() {
    state.isStreaming = false;
    state.streamingText = '';
    $('btn-send').hidden = false;
    $('btn-stop').hidden = true;
    $('streaming').hidden = true;
    $('composer-status').textContent = '';
  }

  function handleDecompositionResult(result) {
    state.decompositionResult = result;
    renderDecompositionResult();
  }

  function handleMergePreview(preview, sourceBranchId, targetBranchId) {
    state.pendingMergePreview = preview;
    state.pendingMerge = { sourceBranchId, targetBranchId };
    $('merge-running').hidden = true;
    renderMergePreview();
  }

  function handleMergeCompleted(event, cascadingApplied, conflictsResolved) {
    closeModal('modal-merge');
    const parts = [];
    if (cascadingApplied > 0) parts.push(`${cascadingApplied} cascading edit${cascadingApplied === 1 ? '' : 's'}`);
    if (conflictsResolved > 0) parts.push(`${conflictsResolved} conflict${conflictsResolved === 1 ? '' : 's'} ai-resolved`);
    const suffix = parts.length ? ` (${parts.join(', ')} applied)` : '';
    showStatus(
      (event.verification.forced
        ? 'Force-merged with failing checks.'
        : 'Merge complete.') + suffix,
      event.verification.forced ? 'error' : 'success'
    );
  }

  // ─── render ───────────────────────────────────────────────────────────

  function render() {
    // Topbar
    $('active-branch-name').textContent = state.activeBranchName || 'main';

    // Banner: condition mode / provider warning / non-main reminder / no workspace
    const banner = $('banner');
    let bannerHtml = '';
    if (state.noWorkspace) {
      bannerHtml = '⚠ No folder open. Use <strong>File → Open Folder</strong> in this window — ContextBranch stores data per workspace.';
    } else if (!state.providerReady) {
      bannerHtml = '⚠ No API key set. Open the Command Palette (Ctrl/Cmd+Shift+P) and run <strong>ContextBranch: Set API Key</strong>.';
    } else if (state.condition === 'linear') {
      bannerHtml = '⚠ Study mode: linear condition — branching is disabled.';
    } else if (!state.isMain) {
      bannerHtml = `Editing branch <strong>${escapeHtml(state.activeBranchName)}</strong>. Workspace files are not changed unless you click Apply in the ⋯ menu.`;
    }
    if (bannerHtml) {
      banner.innerHTML = bannerHtml;
      banner.hidden = false;
      banner.classList.toggle('info', state.providerReady);
    } else {
      banner.hidden = true;
    }

    // Branch dropdown lists
    const activeUl = $('branch-list-active');
    const archivedUl = $('branch-list-archived');
    activeUl.innerHTML = '';
    archivedUl.innerHTML = '';
    let archivedCount = 0;

    for (const b of state.branches) {
      const li = document.createElement('li');
      li.className = 'branch-row';
      if (b.id === state.activeBranchId) li.classList.add('active');

      const name = document.createElement('span');
      name.className = 'branch-row-name';
      name.textContent = b.name;

      const status = document.createElement('span');
      status.className = 'branch-row-status ' + b.status;
      status.textContent = b.status;

      const count = document.createElement('span');
      count.className = 'branch-row-count';
      count.textContent = `${b.messageCount}`;

      li.appendChild(name);
      li.appendChild(status);
      li.appendChild(count);
      li.addEventListener('click', () => {
        send({ type: 'switchBranch', branchId: b.id });
        closeDropdown('branch-dropdown');
      });

      if (b.status === 'merged' || b.status === 'abandoned') {
        archivedUl.appendChild(li);
        archivedCount++;
      } else {
        activeUl.appendChild(li);
      }
    }
    archivedUl.parentElement.style.display = archivedCount === 0 ? 'none' : '';

    // Empty state vs messages
    const hasMessages = state.messages.length > 0;
    $('empty-state').hidden = hasMessages;
    $('messages').hidden = !hasMessages;

    // Messages
    const msgs = $('messages');
    msgs.innerHTML = '';
    for (const m of state.messages) {
      const div = document.createElement('div');
      div.className = `message ${m.role}`;

      const role = document.createElement('div');
      role.className = 'role-label';
      role.textContent = m.role;
      div.appendChild(role);

      const body = document.createElement('div');
      body.className = 'message-body';
      body.innerHTML = renderMessageContent(m.content);
      div.appendChild(body);

      // Per-message actions
      if ((m.role === 'user' || m.role === 'assistant') && state.condition !== 'linear') {
        const actions = document.createElement('div');
        actions.className = 'message-actions';

        const branchBtn = document.createElement('button');
        branchBtn.className = 'message-action';
        branchBtn.textContent = 'Branch from here';
        branchBtn.addEventListener('click', () => openBranchModal(m.id));
        actions.appendChild(branchBtn);

        div.appendChild(actions);
      }
      msgs.appendChild(div);
    }
    if (hasMessages) scrollToBottom();

    // Action menu enable/disable
    const merge = $('menu-merge');
    const apply = $('menu-apply');
    const abandon = $('menu-abandon');
    merge.disabled = state.isMain || state.condition === 'linear';
    apply.disabled = false;
    abandon.disabled = state.isMain;

    // Send button enabled state
    $('btn-send').disabled = !state.providerReady || state.isStreaming;
    $('composer-input').placeholder = state.providerReady
      ? 'Message...'
      : 'Set an API key first (Cmd/Ctrl+Shift+P → ContextBranch: Set API Key)';
  }
  function renderHistoryView() {
    console.log('[history] renderHistoryView called');
    const hg = state.historyGraph;
    console.log('[history] historyGraph is:', hg);

    const svg = $('history-svg');
    const empty = $('history-empty');

    if (!hg) {
      console.log('[history] bailing: historyGraph is null/undefined');
      svg.innerHTML = '';
      empty.hidden = false;
      return;
    }

    console.log('[history] branches:', hg.branches?.length,
                'checkpoints:', hg.checkpoints?.length,
                'mergeEvents:', hg.mergeEvents?.length);

    if (hg.branches.length <= 1 && hg.checkpoints.length === 0 && hg.mergeEvents.length === 0) {
      console.log('[history] bailing: empty state condition met');
      svg.innerHTML = '';
      empty.hidden = false;
      return;
    }

    empty.hidden = true;
    console.log('[history] about to build model');
    const model = buildGraphModel(hg);
    console.log('[history] model:', model.nodes.length, 'nodes,', model.edges.length, 'edges');

    const laidOut = layoutGraph(model);
    console.log('[history] laid out, width:', laidOut.width, 'height:', laidOut.height);

    renderGraph(laidOut);
    console.log('[history] renderGraph done. SVG now has', svg.children.length, 'children');
  }

  function buildGraphModel(hg) {
  const nodes = [];
  const edges = [];
  const branchMap = new Map(hg.branches.map(b => [b.id, b]));

  const mergeEvents = (hg.mergeEvents || [])
    .slice()
    .sort((a, b) =>
      (a.completedAt || a.startedAt || 0) - (b.completedAt || b.startedAt || 0)
    );

  // 1. Branch nodes
  for (const b of hg.branches) {
    nodes.push({
      id: 'br:' + b.id,
      kind: 'branch',
      label: b.name,
      branch: b,
      createdAt: b.createdAt,
    });
  }

  // 2. Merge nodes — each merge becomes a real node in the tree, parented
  //    to the TARGET branch (or to the target's latest merge node, so chains
  //    of merges into the same target stack correctly).
  const latestMergeIntoTarget = new Map(); // targetBranchId -> merge node id

  for (const m of mergeEvents) {
    const mergeNodeId = 'mg:' + m.id;
    const when = m.completedAt || m.startedAt || 0;

    // Resolve source and target branch names for a more informative label
    const sourceBranch = branchMap.get(m.sourceBranchId);
    const targetBranch = branchMap.get(m.targetBranchId);
    const sourceName = sourceBranch ? sourceBranch.name : m.sourceBranchId;
    const targetName = targetBranch ? targetBranch.name : m.targetBranchId;

    nodes.push({
      id: mergeNodeId,
      kind: 'merge',
      label: `${sourceName} → ${targetName}`,
      mergeEvent: m,
      sourceBranchId: m.sourceBranchId,
      sourceBranchName: sourceName,
      targetBranchId: m.targetBranchId,
      targetBranchName: targetName,
      createdAt: when,
    });

    // Tree parent of a merge node is the current "tip" of the target branch:
    // either the previous merge into that target, or the target branch node.
    const targetTip = latestMergeIntoTarget.get(m.targetBranchId)
      || ('br:' + m.targetBranchId);
    edges.push({ from: targetTip, to: mergeNodeId, kind: 'mainline' });

    // The source branch feeds into the merge — drawn distinctly, NOT a tree edge.
    edges.push({ from: 'br:' + m.sourceBranchId, to: mergeNodeId, kind: 'merge' });

    latestMergeIntoTarget.set(m.targetBranchId, mergeNodeId);
  }

  // 3. Fork edges — but re-parent onto a merge node if the branch forked
  //    AFTER a merge into its parent. This is the key change: a branch
  //    created from a post-merge state hangs off the merge node.
  for (const b of hg.branches) {
    if (!b.parentBranchId) continue;
    const forkTime = b.createdAt;

    // Find the latest merge into this branch's parent that happened
    // before the fork. If one exists, parent the fork to that merge node.
    let parentNodeId = 'br:' + b.parentBranchId;
    let bestMergeTime = -Infinity;

    for (const m of mergeEvents) {
      if (m.targetBranchId !== b.parentBranchId) continue;
      const when = m.completedAt || m.startedAt || 0;
      if (when <= forkTime && when > bestMergeTime) {
        bestMergeTime = when;
        parentNodeId = 'mg:' + m.id;
      }
    }

    edges.push({ from: parentNodeId, to: 'br:' + b.id, kind: 'fork' });
  }

  return { nodes, edges, branchMap, mergeEvents };
}
function computeDepths(model) {
  const depth = new Map();

  function getDepth(branchId) {
    if (depth.has(branchId)) return depth.get(branchId);

    const b = model.branchMap.get(branchId);
    if (!b || !b.parentBranchId) {
      depth.set(branchId, 0);
      return 0;
    }

    const d = 1 + getDepth(b.parentBranchId);
    depth.set(branchId, d);
    return d;
  }

  for (const b of model.branchMap.values()) {
    getDepth(b.id);
  }

  return depth;
}
function layoutGraph(model) {
  const NODE_SPACING_X = 120;
  const ROW_H = 100;
  const PAD_X = 60;
  const PAD_Y = 60;

  // Build adjacency from the edges that define the TREE (fork + mainline).
  // Merge-source edges are overlays and must not influence the layout tree.
  const nodeById = new Map(model.nodes.map(n => [n.id, n]));
  const childrenOf = new Map(model.nodes.map(n => [n.id, []]));
  const hasParent = new Set();

  for (const e of model.edges) {
    if (e.kind === 'merge') continue; // overlay only
    if (!nodeById.has(e.from) || !nodeById.has(e.to)) continue;
    childrenOf.get(e.from).push(e.to);
    hasParent.add(e.to);
  }

  const roots = model.nodes.filter(n => !hasParent.has(n.id)).map(n => n.id);

  // Stable ordering by creation time, then id.
  const orderKey = (id) => {
    const n = nodeById.get(id);
    return [n.createdAt || 0, id];
  };
  const cmp = (a, b) => {
    const [ta, ia] = orderKey(a), [tb, ib] = orderKey(b);
    return ta - tb || String(ia).localeCompare(String(ib));
  };
  roots.sort(cmp);
  childrenOf.forEach(ch => ch.sort(cmp));

  // Subtree logical widths (bottom-up).
  const logicalWidth = new Map();
  function calcWidth(id) {
    const kids = childrenOf.get(id);
    if (kids.length === 0) { logicalWidth.set(id, 1); return 1; }
    let w = 0;
    for (const c of kids) w += calcWidth(c);
    logicalWidth.set(id, w);
    return w;
  }
  let totalWidth = 0;
  for (const r of roots) totalWidth += calcWidth(r);

  // Position centered (top-down).
  const positioned = [];
  let maxDepth = 0;
  function place(id, depth, startX) {
    if (depth > maxDepth) maxDepth = depth;
    const myW = logicalWidth.get(id) * NODE_SPACING_X;
    const cx = startX + myW / 2;
    const cy = depth * ROW_H;
    positioned.push(Object.assign({}, nodeById.get(id), {
      x: PAD_X + cx,
      y: PAD_Y + cy,
    }));
    let childX = startX;
    for (const c of childrenOf.get(id)) {
      place(c, depth + 1, childX);
      childX += logicalWidth.get(c) * NODE_SPACING_X;
    }
  }
  let rootX = 0;
  for (const r of roots) {
    place(r, 0, rootX);
    rootX += logicalWidth.get(r) * NODE_SPACING_X;
  }

  // Edges.
  const posById = new Map(positioned.map(n => [n.id, n]));
  const positionedEdges = [];
  for (const e of model.edges) {
    const from = posById.get(e.from);
    const to = posById.get(e.to);
    if (!from || !to) continue;
    positionedEdges.push({
      kind: e.kind,
      type: e.kind === 'merge' ? 'merge' : 'parent',
      pathData: buildStraightEdge(from, to),
    });
  }

  return {
    nodes: positioned,
    edges: positionedEdges,
    width: PAD_X * 2 + totalWidth * NODE_SPACING_X,
    height: PAD_Y * 2 + maxDepth * ROW_H,
  };
}
// ------------------------------------------------------------
// Bulletproof Edge Routing
// ------------------------------------------------------------
function buildGitLaneEdge(from, to, ROW_H) {
  const NODE_RADIUS = 16;
  const ARROW_CLEARANCE = 6;
  
  const startX = from.x;
  const startY = from.y + NODE_RADIUS;
  
  const endX = to.x;
  const endY = to.y - NODE_RADIUS - ARROW_CLEARANCE;

  // Straight down (fallback if they ever share a lane)
  if (startX === endX) {
    return `M ${startX} ${startY} L ${endX} ${endY}`;
  }

  // SWOOP ROUTING
  const controlDrop = 25; 
  // Drop out of the parent node, curve into the target lane, and drop straight down.
  const laneEntryY = from.y + (ROW_H * 0.6); 

  return `M ${startX} ${startY} 
          C ${startX} ${startY + controlDrop}, 
            ${endX} ${laneEntryY - controlDrop}, 
            ${endX} ${laneEntryY}
          L ${endX} ${endY}`;
}
function buildStraightEdge(from, to) {
  const NODE_RADIUS = 16;
  const ARROW_CLEARANCE = 6; 
  
  // Calculate the distance and angle between the two nodes
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const angle = Math.atan2(dy, dx);
  
  // Start the line exactly at the bottom edge of the parent circle
  const startX = from.x + Math.cos(angle) * NODE_RADIUS;
  const startY = from.y + Math.sin(angle) * NODE_RADIUS;
  
  // Stop the line just above the child circle (leaving room for the arrow)
  const endX = to.x - Math.cos(angle) * (NODE_RADIUS + ARROW_CLEARANCE);
  const endY = to.y - Math.sin(angle) * (NODE_RADIUS + ARROW_CLEARANCE);
  
  // Draw a standard SVG straight line (L)
  return `M ${startX} ${startY} L ${endX} ${endY}`;
}
function renderGraph(g) {
  const SVG_NS = 'http://www.w3.org/2000/svg';
  const svg = $('history-svg');

  svg.innerHTML = '';

  // --------------------------------------------------
  // SVG sizing
  // --------------------------------------------------

  svg.setAttribute('width', g.width);
  svg.setAttribute('height', g.height);
  svg.setAttribute('viewBox', `0 0 ${g.width} ${g.height}`);

  // --------------------------------------------------
  // Camera group (FIXES YOUR ERROR)
  // --------------------------------------------------

  const camera = document.createElementNS(SVG_NS, 'g');
  camera.setAttribute('class', 'graph-camera');
  svg.appendChild(camera);

  // --------------------------------------------------
  // Zoom + pan state
  // --------------------------------------------------

  let scale = 1;
  let panX = 0;
  let panY = 0;

  function updateCamera() {
    camera.setAttribute(
      'transform',
      `translate(${panX}, ${panY}) scale(${scale})`
    );
  }

  updateCamera();

  // --------------------------------------------------
  // Mouse wheel zoom
  // --------------------------------------------------

  svg.onwheel = (e) => {
    e.preventDefault();

    const delta = e.deltaY > 0 ? 0.9 : 1.1;

    scale *= delta;

    scale = Math.max(0.3, Math.min(scale, 4));

    updateCamera();
  };

  // --------------------------------------------------
  // Drag panning
  // --------------------------------------------------

  let dragging = false;
  let lastX = 0;
  let lastY = 0;

  svg.onmousedown = (e) => {
    dragging = true;
    lastX = e.clientX;
    lastY = e.clientY;
  };

  window.onmouseup = () => {
    dragging = false;
  };

  window.onmousemove = (e) => {
    if (!dragging) return;

    const dx = e.clientX - lastX;
    const dy = e.clientY - lastY;

    lastX = e.clientX;
    lastY = e.clientY;

    panX += dx;
    panY += dy;

    updateCamera();
  };

  // --------------------------------------------------
  // Arrow defs
  // --------------------------------------------------

  const defs = document.createElementNS(SVG_NS, 'defs');

  const marker = document.createElementNS(SVG_NS, 'marker');

  marker.setAttribute('id', 'arrow');
  marker.setAttribute('viewBox', '0 0 10 10');
  marker.setAttribute('refX', '8');
  marker.setAttribute('refY', '5');
  marker.setAttribute('markerWidth', '6');
  marker.setAttribute('markerHeight', '6');
  marker.setAttribute('orient', 'auto');

  const arrowPath = document.createElementNS(SVG_NS, 'path');

  arrowPath.setAttribute(
    'd',
    'M 0 0 L 10 5 L 0 10 z'
  );

  arrowPath.setAttribute(
    'fill',
    'var(--vscode-descriptionForeground)'
  );

  marker.appendChild(arrowPath);

  defs.appendChild(marker);

  svg.appendChild(defs);

  // --------------------------------------------------
  // Draw edges FIRST
  // --------------------------------------------------

for (const e of g.edges) {
  const path = document.createElementNS(SVG_NS, 'path');

  // Your path data (now straight lines instead of bezier)
  path.setAttribute('d', e.pathData); 
  path.setAttribute('fill', 'none');
  
  // Dynamic styling based on the type we assigned in the layout
  if (e.type === 'merge') {
    // Style for Merges: Different color and dashed lines
    path.setAttribute('stroke', '#e67e22'); // Distinct color
    path.setAttribute('stroke-dasharray', '5,5'); // Dashed for merge
  } else {
    // Style for Hierarchy: Standard color
    path.setAttribute('stroke', 'var(--vscode-descriptionForeground, #666)');
  }
  
  path.setAttribute('stroke-width', '2');
  path.setAttribute('marker-end', 'url(#arrow)');

  camera.appendChild(path);
}

  // --------------------------------------------------
  // Draw nodes SECOND
  // --------------------------------------------------

   for (const n of g.nodes) {
    const group = document.createElementNS(SVG_NS, 'g');
    group.style.cursor = 'pointer';

    const isMerge = n.kind === 'merge';
    const circle = document.createElementNS(SVG_NS, 'circle');
    circle.setAttribute('cx', n.x);
    circle.setAttribute('cy', n.y);
    circle.setAttribute('r', isMerge ? 11 : 16);
    circle.setAttribute(
      'fill',
      isMerge ? '#e67e22'
        : (n.branch.id === state.activeBranchId ? '#4FC3F7' : '#2d2d30')
    );
    circle.setAttribute('stroke', '#888');
    circle.setAttribute('stroke-width', '2');
    group.appendChild(circle);

    const text = document.createElementNS(SVG_NS, 'text');
    text.setAttribute('x', n.x + 28);
    text.setAttribute('y', n.y + 5);
    text.setAttribute('fill', 'var(--vscode-editor-foreground)');
    text.setAttribute('font-size', '13');
    text.textContent = n.label;
    group.appendChild(text);

    const title = document.createElementNS(SVG_NS, 'title');
    title.textContent = isMerge ? tooltipFor(n)
      : `${n.branch.name}\nStatus: ${n.branch.status}\nMessages: ${n.branch.messageCount ?? 0}`;
    group.appendChild(title);

    group.addEventListener('click', (e) => {
      e.stopPropagation();
      onHistoryNodeClick(n);
    });

    camera.appendChild(group);
  }
}

function truncate(s, max) {
  if (!s) return '';
  return s.length > max ? s.slice(0, max - 1) + '…' : s;
}


/**
 * Move the endpoint of an edge back toward the start by `r` pixels.
 * Used so the arrowhead sits just outside the target node instead of
 * being half-buried under it.
 */
function shortenEnd(from, to, r) {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const len = Math.hypot(dx, dy);
  if (len <= r) return { x: to.x, y: to.y };
  return {
    x: to.x - (dx / len) * r,
    y: to.y - (dy / len) * r,
  };
}

function tooltipFor(n) {
  if (n.kind === 'branch') {
    const b = n.branch;
    return `Branch: ${b.name}\nStatus: ${b.status}\n${b.messageCount ?? b.messageIds?.length ?? 0} messages`;
  }
  if (n.kind === 'checkpoint') {
    const cp = n.checkpoint;
    const when = new Date(cp.createdAt || 0).toLocaleString();
    return `Checkpoint (${cp.kind || 'manual'})\n${cp.label || '(no label)'}\n${when}`;
  }
  if (n.kind === 'merge') {
    const ev = n.mergeEvent;
    const when = new Date(ev.timestamp || ev.createdAt || 0).toLocaleString();
    return `Merge\nStatus: ${ev.verification?.status || 'unknown'}\n${when}`;
  }
  return '';
}

  function onHistoryNodeClick(node) {
  state.selectedHistoryNodeId = node.id;
  const detail = $('history-detail');
  const title = $('history-detail-title');
  const body = $('history-detail-body');
  detail.hidden = false;
  body.innerHTML = '';

  if (node.kind === 'branch') {
    renderBranchCard(node, title, body);
  } else if (node.kind === 'merge') {
    renderMergeCard(node, title, body);
  } else {
    title.textContent = 'Unknown';
    body.textContent = 'No details available.';
  }
}

/**
 * Card for a branch node — the branch from its creation until either
 * the first merge into it, or "now" if there have been no merges.
 */
function renderBranchCard(node, title, body) {
  const b = node.branch;
  const isActive = b.id === state.activeBranchId;

  // Lifetime: from branch.createdAt up to the first merge into this branch
  // (or +Infinity if there have been none yet).
  const merges = (state.historyGraph?.mergeEvents || [])
    .filter(ev => ev.targetBranchId === b.id)
    .sort((a, b) => (a.completedAt || a.startedAt || 0) - (b.completedAt || b.startedAt || 0));

  const windowStart = b.createdAt || 0;
  const windowEnd = merges[0]
    ? (merges[0].completedAt || merges[0].startedAt || Infinity)
    : Infinity;

  // ── Header ──
  title.textContent = b.name;

  // ── Meta line ──
  appendP(body, `${b.status} · ${b.messageCount ?? 0} messages`, 'muted');

  if (b.description) {
    appendP(body, b.description);
  }

  if (isActive) {
    appendP(body, '(currently active)', 'muted');
  }

  // ── Checkpoints in this lifetime ──
  renderCheckpointSection(body, b.id, windowStart, windowEnd);

  // ── Switch button ──
  if (!isActive && b.status !== 'merged' && b.status !== 'abandoned') {
    appendSwitchButton(body, b.id);
  }
}

/**
 * Card for a merge node — represents the target branch from THIS merge
 * up to the next merge into the same target (or "now" if it's the latest).
 */
function renderMergeCard(node, title, body) {
  const ev = node.mergeEvent;
  const v = ev.verification || {};
  const targetBranchId = ev.targetBranchId;
  const sourceName = node.sourceBranchName || ev.sourceBranchId;
  const targetName = node.targetBranchName || ev.targetBranchId;
  const isActive = targetBranchId === state.activeBranchId;

  // Lifetime: from this merge's time up to the NEXT merge into the same target
  // (if any). If this is the latest merge into the target, the window is open-ended.
  const mergesIntoTarget = (state.historyGraph?.mergeEvents || [])
    .filter(m => m.targetBranchId === targetBranchId)
    .sort((a, b) => (a.completedAt || a.startedAt || 0) - (b.completedAt || b.startedAt || 0));

  const thisMergeTime = ev.completedAt || ev.startedAt || 0;
  const myIdx = mergesIntoTarget.findIndex(m => m.id === ev.id);
  const nextMerge = mergesIntoTarget[myIdx + 1];
  const windowStart = thisMergeTime;
  const windowEnd = nextMerge
    ? (nextMerge.completedAt || nextMerge.startedAt || Infinity)
    : Infinity;

  // ── Header ──
  title.textContent = `${sourceName} → ${targetName}`;

  // ── Meta lines ──
  const when = new Date(thisMergeTime).toLocaleString();
  appendP(body, when, 'muted');
  appendP(body, `Status: ${v.status || 'unknown'}${v.forced ? ' (forced)' : ''}`);

  if (ev.rebaseNotes && ev.rebaseNotes.length) {
    appendP(body, ev.rebaseNotes.join('; '), 'muted');
  }

  if (isActive) {
    appendP(body, '(target is currently active)', 'muted');
  }

  // ── Checkpoints on the TARGET branch in this lifetime ──
  renderCheckpointSection(body, targetBranchId, windowStart, windowEnd);

  // ── Switch to the (target) branch ──
  if (!isActive) {
    const targetBranch = state.historyGraph?.branches?.find(b => b.id === targetBranchId);
    if (targetBranch && targetBranch.status !== 'abandoned') {
      appendSwitchButton(body, targetBranchId);
    }
  }
}

// ─── helpers used by both card types ────────────────────────────────────

function renderCheckpointSection(parent, branchId, windowStart, windowEnd) {
  const allCheckpoints = state.historyGraph?.checkpoints || [];
  const inWindow = allCheckpoints
    .filter(cp => cp.branchId === branchId)
    .filter(cp => {
      const t = cp.createdAt || 0;
      return t >= windowStart && t < windowEnd;
    })
    .sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));

  const header = document.createElement('div');
  header.className = 'detail-section-header';
  header.textContent = `Checkpoints (${inWindow.length})`;
  parent.appendChild(header);

  if (inWindow.length === 0) {
    appendP(parent, 'No checkpoints in this period.', 'muted detail-empty');
    return;
  }

  const ul = document.createElement('ul');
  ul.className = 'detail-checkpoint-list';
  for (const cp of inWindow) {
    const li = document.createElement('li');
    li.className = 'detail-checkpoint-item';

    const dot = document.createElement('span');
    dot.className = 'detail-checkpoint-dot ' + (cp.kind || 'manual');
    li.appendChild(dot);

    const main = document.createElement('div');
    main.className = 'detail-checkpoint-main';

    const label = document.createElement('div');
    label.className = 'detail-checkpoint-label';
    label.textContent = cp.label || `(${cp.kind || 'manual'} checkpoint)`;
    main.appendChild(label);

    const meta = document.createElement('div');
    meta.className = 'detail-checkpoint-meta';
    const when = new Date(cp.createdAt || 0).toLocaleString();
    meta.textContent = `${when} · ${cp.messageIds.length} msgs · ${cp.artifactIds.length} files`;
    main.appendChild(meta);

    li.appendChild(main);
    ul.appendChild(li);
  }
  parent.appendChild(ul);
}

function appendP(parent, text, cls) {
  const p = document.createElement('p');
  if (cls) p.className = cls;
  p.textContent = text;
  parent.appendChild(p);
  return p;
}

function appendSwitchButton(parent, branchId) {
  const btn = document.createElement('button');
  btn.className = 'btn-primary detail-switch-btn';
  btn.textContent = 'Switch to this branch';
  btn.addEventListener('click', () => {
    send({ type: 'switchBranch', branchId });
    $('history-detail').hidden = true;
  });
  parent.appendChild(btn);
}

/**
 * For a given branch and instance index, return the timestamp of the NEXT
 * instance (i.e., the next merge into this branch). If there isn't one,
 * return Infinity so we include everything after `instanceIdx`'s creation.
 */
function findNextInstanceTime(branchId, instanceIdx) {
  const merges = (state.historyGraph?.mergeEvents || [])
    .filter(ev => ev.targetBranchId === branchId)
    .sort((a, b) => (a.completedAt || a.startedAt || 0) - (b.completedAt || b.startedAt || 0));
  // Each merge creates a new instance. Instance 0 ends when merge 0 happens,
  // instance 1 ends when merge 1 happens, etc.
  const nextMerge = merges[instanceIdx];
  if (!nextMerge) return Infinity;
  return nextMerge.completedAt || nextMerge.startedAt || Infinity;
}

  function renderMessageContent(content) {
    // Minimal markdown-ish rendering: code fences and inline code
    let html = escapeHtml(content);
    html = html.replace(/```(\w*)\n?([\s\S]*?)```/g, (_, lang, body) =>
      `<pre><code>${body}</code></pre>`);
    html = html.replace(/`([^`\n]+)`/g, '<code>$1</code>');
    return html;
  }

  function scrollToBottom() {
    const conv = $('conversation');
    conv.scrollTop = conv.scrollHeight;
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  // ─── decomposition ────────────────────────────────────────────────────

  function renderDecompositionResult() {
    const r = state.decompositionResult;
    const out = $('decompose-result');
    if (!r) { out.hidden = true; return; }
    out.hidden = false;
    out.innerHTML = '';

    const sec = document.createElement('div');
    sec.className = 'decomp-section';
    sec.innerHTML = '<h4>Proposed branches</h4>';
    for (const b of r.branches) {
      const div = document.createElement('div');
      div.className = 'decomp-branch';

      const name = document.createElement('div');
      name.className = 'decomp-branch-name';
      name.textContent = b.name;
      div.appendChild(name);

      const scope = document.createElement('div');
      scope.className = 'decomp-branch-scope';
      scope.textContent = b.scope;
      div.appendChild(scope);

      const order = (r.mergeOrder || []).find((o) => o.branch === b.name);
      if (order && order.after && order.after.length) {
        const deps = document.createElement('div');
        deps.className = 'decomp-deps';
        deps.textContent = `↳ Merge after: ${order.after.join(', ')} — ${order.reason}`;
        div.appendChild(deps);
      }
      sec.appendChild(div);
    }
    out.appendChild(sec);

    if (r.overlapWarnings && r.overlapWarnings.length) {
      const warn = document.createElement('div');
      warn.className = 'decomp-section';
      warn.innerHTML = '<h4>⚠ Overlap warnings</h4>';
      for (const ow of r.overlapWarnings) {
        const w = document.createElement('div');
        w.className = 'decomp-warning';
        w.textContent = `${ow.branches.join(' & ')}: ${ow.note}`;
        warn.appendChild(w);
      }
      out.appendChild(warn);
    }
    $('decompose-create-all').hidden = false;
    $('decompose-go').hidden = true;
  }

  function renderCascadingProposals(p) {
    const wrap = $('merge-cascading');
    const summarySpan = $('merge-cascading-summary');
    const list = $('merge-cascading-list');
    const proposals = (p && p.cascadingProposals) || [];
    const summary = (p && p.cascadingSummary) || '';

    if (proposals.length === 0 && !summary) {
      wrap.hidden = true;
      return;
    }

    wrap.hidden = false;
    summarySpan.textContent = summary ? '— ' + summary : '';
    list.innerHTML = '';

    if (proposals.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'cascade-empty';
      empty.textContent = 'No cascading edits proposed.';
      list.appendChild(empty);
      return;
    }

    proposals.forEach((proposal, i) => {
      const item = document.createElement('div');
      item.className = 'cascade-item';

      // Checkbox row
      const head = document.createElement('label');
      head.className = 'cascade-head';
      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.checked = true; // proposals are opt-out by default
      cb.dataset.cascadePath = proposal.path;
      cb.className = 'cascade-checkbox';
      const title = document.createElement('span');
      title.className = 'cascade-title';
      title.innerHTML = `<code>${escapeHtml(proposal.path)}</code>`;
      head.appendChild(cb);
      head.appendChild(title);
      item.appendChild(head);

      // Rationale
      if (proposal.rationale) {
        const r = document.createElement('div');
        r.className = 'cascade-rationale';
        r.textContent = proposal.rationale;
        item.appendChild(r);
      }

      // Expand/collapse diff
      const toggle = document.createElement('button');
      toggle.type = 'button';
      toggle.className = 'cascade-toggle';
      toggle.textContent = 'show diff';
      const diff = document.createElement('pre');
      diff.className = 'cascade-diff';
      diff.hidden = true;
      diff.textContent = simpleLineDiff(proposal.currentContent || '', proposal.proposedContent || '');
      toggle.addEventListener('click', () => {
        diff.hidden = !diff.hidden;
        toggle.textContent = diff.hidden ? 'show diff' : 'hide diff';
      });
      item.appendChild(toggle);
      item.appendChild(diff);

      list.appendChild(item);
    });
  }

  function collectAcceptedCascadeProposals() {
    const boxes = document.querySelectorAll('input.cascade-checkbox');
    const accepted = [];
    boxes.forEach((b) => { if (b.checked) accepted.push(b.dataset.cascadePath); });
    return accepted;
  }

  function renderConflictResolutions(p) {
    const wrap = $('merge-conflicts');
    const list = $('merge-conflicts-list');
    const resolutions = (p && p.conflictResolutions) || [];

    if (resolutions.length === 0) {
      wrap.hidden = true;
      return;
    }
    wrap.hidden = false;
    list.innerHTML = '';

    resolutions.forEach((res) => {
      const item = document.createElement('div');
      item.className = 'cascade-item conflict-item';

      const head = document.createElement('label');
      head.className = 'cascade-head';
      const cb = document.createElement('input');
      cb.type = 'checkbox';
      // Default to accepting only high-confidence resolutions. Medium/low get
      // shown but unchecked — the user decides.
      cb.checked = res.confidence === 'high';
      cb.dataset.conflictPath = res.path;
      cb.className = 'conflict-checkbox';
      const title = document.createElement('span');
      title.className = 'cascade-title';
      const badge = `<span class="conf-badge conf-${res.confidence}">${res.confidence}</span>`;
      title.innerHTML = `<code>${escapeHtml(res.path)}</code> ${badge}`;
      head.appendChild(cb);
      head.appendChild(title);
      item.appendChild(head);

      if (res.rationale) {
        const r = document.createElement('div');
        r.className = 'cascade-rationale';
        r.textContent = res.rationale;
        item.appendChild(r);
      }
      if (res.error) {
        // Resolver failed — show why, and the checkbox defaults to UNCHECKED
        // so the user falls back to textual conflict markers unless they
        // explicitly opt in to the unsafe fallback content.
        cb.checked = false;
        const e = document.createElement('div');
        e.className = 'cascade-rationale cascade-error';
        e.textContent = 'Resolver error: ' + res.error;
        item.appendChild(e);
      }

      const toggle = document.createElement('button');
      toggle.type = 'button';
      toggle.className = 'cascade-toggle';
      toggle.textContent = 'show resolution';
      const diff = document.createElement('pre');
      diff.className = 'cascade-diff';
      diff.hidden = true;
      // Show the diff from target's current content → AI-resolved content,
      // since that's what the user is about to commit to.
      diff.textContent = simpleLineDiff(res.originalContent || '', res.resolvedContent || '');
      toggle.addEventListener('click', () => {
        diff.hidden = !diff.hidden;
        toggle.textContent = diff.hidden ? 'show resolution' : 'hide resolution';
      });
      item.appendChild(toggle);
      item.appendChild(diff);

      list.appendChild(item);
    });
  }

  function collectAcceptedConflictResolutions() {
    const boxes = document.querySelectorAll('input.conflict-checkbox');
    const accepted = [];
    boxes.forEach((b) => { if (b.checked) accepted.push(b.dataset.conflictPath); });
    return accepted;
  }

  /**
   * Cheap human-readable line diff. Not real diff3 — just shows what's
   * different line-by-line with - / + prefixes. Good enough for the preview;
   * the LLM's proposedContent is the real source of truth.
   */
  function simpleLineDiff(before, after) {
    const a = before.split('\n');
    const b = after.split('\n');
    const lines = [];
    const max = Math.max(a.length, b.length);
    for (let i = 0; i < max; i++) {
      if (a[i] === undefined) lines.push('+ ' + b[i]);
      else if (b[i] === undefined) lines.push('- ' + a[i]);
      else if (a[i] !== b[i]) {
        lines.push('- ' + a[i]);
        lines.push('+ ' + b[i]);
      } else {
        lines.push('  ' + a[i]);
      }
    }
    // Keep it readable — first 200 lines.
    return lines.slice(0, 200).join('\n') + (lines.length > 200 ? '\n...' : '');
  }

  function renderMergePreview() {
    const p = state.pendingMergePreview;
    if (!p) return;
    $('merge-preview').hidden = false;

    const v = $('merge-verification');
    v.className = 'verification-panel ' + p.verification.status;
    let html = `<strong>Verification: ${p.verification.status.toUpperCase()}</strong>`;
    if (p.verification.testOutput) {
      html += `<pre>${escapeHtml(p.verification.testOutput.slice(0, 2000))}</pre>`;
    }
    if (p.verification.consistencyWarnings && p.verification.consistencyWarnings.length) {
      html += '<ul>';
      for (const w of p.verification.consistencyWarnings) {
        html += `<li>${escapeHtml(w)}</li>`;
      }
      html += '</ul>';
    }
    v.innerHTML = html;

    const r = $('merge-rebase-notes');
    if (p.rebaseNotes && p.rebaseNotes.length) {
      r.innerHTML = '<strong>Rebase notes:</strong><ul>' +
        p.rebaseNotes.map((n) => `<li>${escapeHtml(n)}</li>`).join('') + '</ul>';
      r.hidden = false;
    } else { r.hidden = true; }

    const a = $('merge-artifact-changes');
    if (p.artifactChanges && p.artifactChanges.length) {
      a.innerHTML = '<strong>Artifact changes:</strong><ul>' +
        p.artifactChanges.map((c) => `<li><code>${escapeHtml(c.path)}</code> — ${c.status}</li>`).join('') + '</ul>';
      a.hidden = false;
    } else { a.hidden = true; }

    renderCascadingProposals(p);
    renderConflictResolutions(p);

    const s = $('merge-synthesis');
    if (p.synthesisDraft) {
      s.innerHTML = '<strong>Synthesis (will append to target):</strong><pre>' +
        escapeHtml(p.synthesisDraft) + '</pre>';
      s.hidden = false;
    } else { s.hidden = true; }

    $('merge-confirm').hidden = p.verification.status === 'fail';
    $('merge-force').hidden = p.verification.status !== 'fail';
    $('merge-preview-btn').hidden = true;
  }

  // ─── status / errors ─────────────────────────────────────────────────

  function showStatus(message, kind) {
    const div = document.createElement('div');
    div.className = 'status-msg ' + (kind || '');
    const text = document.createElement('span');
    text.textContent = message;
    div.appendChild(text);
    const close = document.createElement('span');
    close.className = 'status-msg-close';
    close.textContent = '×';
    div.appendChild(close);
    div.addEventListener('click', () => div.remove());
    $('status-area').appendChild(div);
    if (kind !== 'error') {
      setTimeout(() => div.remove(), 6000);
    }
  }

  // ─── dropdowns ────────────────────────────────────────────────────────

  function toggleDropdown(id) {
    const all = ['branch-dropdown', 'action-menu'];
    all.forEach((d) => { if (d !== id) $(d).hidden = true; });
    const el = $(id);
    el.hidden = !el.hidden;
  }

  function closeDropdown(id) { $(id).hidden = true; }

  // Click outside to close
  document.addEventListener('click', (e) => {
    if (!e.target.closest('.dropdown') &&
        !e.target.closest('#branch-pill') &&
        !e.target.closest('#btn-menu')) {
      $('branch-dropdown').hidden = true;
      $('action-menu').hidden = true;
    }
  });

  // ─── modals ───────────────────────────────────────────────────────────

  function openModal(id) { $(id).hidden = false; }
  function closeModal(id) { $(id).hidden = true; }

  document.querySelectorAll('[data-close]').forEach((el) => {
    el.addEventListener('click', () => closeModal(el.dataset.close));
  });

  // ─── branch modal ─────────────────────────────────────────────────────

  let branchModalFromMessageId = null;
  function openBranchModal(fromMessageId) {
    branchModalFromMessageId = fromMessageId || null;
    $('branch-name').value = '';
    $('branch-desc').value = '';
    openModal('modal-branch');
    $('branch-name').focus();
  }

  $('branch-create').addEventListener('click', () => {
    const name = $('branch-name').value.trim();
    if (!name) { showStatus('Branch name is required', 'error'); return; }
    send({
      type: 'createBranch',
      name,
      description: $('branch-desc').value.trim() || undefined,
      fromMessageId: branchModalFromMessageId || undefined,
    });
    closeModal('modal-branch');
  });

  // ─── decompose modal ──────────────────────────────────────────────────

  function openDecomposeModal() {
    $('decompose-task').value = '';
    $('decompose-result').hidden = true;
    $('decompose-create-all').hidden = true;
    $('decompose-go').hidden = false;
    state.decompositionResult = null;
    openModal('modal-decompose');
    $('decompose-task').focus();
  }

  $('decompose-go').addEventListener('click', () => {
    const t = $('decompose-task').value.trim();
    if (!t) { showStatus('Describe the task first', 'error'); return; }
    showStatus('Decomposing... (this can take ~10s)', 'info');
    send({ type: 'decompose', taskDescription: t });
  });

  $('decompose-create-all').addEventListener('click', () => {
    const r = state.decompositionResult;
    if (!r) return;
    for (const b of r.branches) {
      send({ type: 'createBranch', name: b.name, description: b.scope });
    }
    showStatus(`Created ${r.branches.length} branches.`, 'success');
    closeModal('modal-decompose');
  });

  // ─── merge modal ──────────────────────────────────────────────────────

  function openMergeModal() {
    $('merge-source-name').textContent = state.activeBranchName;
    const sel = $('merge-target-select');
    sel.innerHTML = '';
    for (const b of state.branches) {
      if (b.id === state.activeBranchId) continue;
      if (b.status === 'merged' || b.status === 'abandoned') continue;
      const o = document.createElement('option');
      o.value = b.id;
      o.textContent = b.name;
      if (b.id === state.mainBranchId) o.selected = true;
      sel.appendChild(o);
    }
    if (sel.options.length === 0) {
      showStatus('No valid merge target — only main exists.', 'error');
      return;
    }
    $('merge-preview').hidden = true;
    $('merge-running').hidden = true;
    $('merge-preview-btn').hidden = false;
    $('merge-confirm').hidden = true;
    $('merge-force').hidden = true;
    openModal('modal-merge');
  }

  $('merge-preview-btn').addEventListener('click', () => {
    const target = $('merge-target-select').value;
    if (!target) {
      showStatus('Pick a target branch first.', 'error');
      return;
    }
    $('merge-running').hidden = false;
    send({
      type: 'previewMerge',
      sourceBranchId: state.activeBranchId,
      targetBranchId: target,
    });
  });

  $('merge-confirm').addEventListener('click', () => {
    if (!state.pendingMerge) return;
    send({
      type: 'mergeBranch',
      sourceBranchId: state.pendingMerge.sourceBranchId,
      targetBranchId: state.pendingMerge.targetBranchId,
      acceptedCascadePaths: collectAcceptedCascadeProposals(),
      acceptedConflictPaths: collectAcceptedConflictResolutions(),
      force: false,
    });
  });

  $('merge-force').addEventListener('click', () => {
    if (!state.pendingMerge) return;
    showStatus('Force-merging…', 'info');
    send({
      type: 'mergeBranch',
      sourceBranchId: state.pendingMerge.sourceBranchId,
      targetBranchId: state.pendingMerge.targetBranchId,
      acceptedCascadePaths: collectAcceptedCascadeProposals(),
      acceptedConflictPaths: collectAcceptedConflictResolutions(),
      force: true,
    });
  });

  // ─── action menu ──────────────────────────────────────────────────────

  document.querySelectorAll('.menu-item').forEach((item) => {
    item.addEventListener('click', () => {
      const action = item.dataset.action;
      closeDropdown('action-menu');
      if (action === 'decompose') openDecomposeModal();
      else if (action === 'newBranch') openBranchModal();
      else if (action === 'merge') openMergeModal();
      else if (action === 'apply') {
        send({ type: 'applyArtifactsToWorkspace', branchId: state.activeBranchId });
      } else if (action === 'abandon') {
        if (confirm(`Abandon branch "${state.activeBranchName}"?`)) {
          send({ type: 'abandonBranch', branchId: state.activeBranchId });
        }
      }
    });
  });

  // ─── send / stop ──────────────────────────────────────────────────────

  function sendMessage() {
    const c = $('composer-input');
    const text = c.value.trim();
    if (!text) return;
    if (!state.providerReady) {
      showStatus('No API key — set one first.', 'error');
      return;
    }
    send({ type: 'send', content: text });
    c.value = '';
  }

  $('btn-send').addEventListener('click', sendMessage);
  $('btn-stop').addEventListener('click', () => send({ type: 'abortStream' }));

  $('composer-input').addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
      e.preventDefault();
      sendMessage();
    }
  });

  // ─── topbar interactions ──────────────────────────────────────────────

  $('branch-pill').addEventListener('click', (e) => {
    e.stopPropagation();
    toggleDropdown('branch-dropdown');
  });

  $('btn-menu').addEventListener('click', (e) => {
      e.stopPropagation();
      toggleDropdown('action-menu');
    });
   $('btn-toggle-history').addEventListener('click', (e) => {
    e.stopPropagation();
    state.historyOpen = !state.historyOpen;
    $('history-pane').hidden = !state.historyOpen;
    $('pane-resizer').hidden = !state.historyOpen;   // ← this line
    $('btn-toggle-history').classList.toggle('active', state.historyOpen);
    if (state.historyOpen) renderHistoryView();
  });

 $('btn-history-close').addEventListener('click', () => {
    state.historyOpen = false;
    $('history-pane').hidden = true;
    $('pane-resizer').hidden = true;                 // ← this line
    $('btn-toggle-history').classList.remove('active');
  });
  $('history-detail-close').addEventListener('click', () => {
    state.selectedHistoryNodeId = null;
    $('history-detail').hidden = true;
  });

  $('btn-history-refresh').addEventListener('click', () => {
    send({ type: 'requestState' });
  });

  // ─── history pane resizer ─────────────────────────────────────────────
  (function initPaneResizer() {
    const resizer = $('pane-resizer');
    const pane = $('history-pane');
    const chat = $('chat-pane');
    const ws = $('workspace');
    if (!resizer || !pane || !chat || !ws) {
      console.warn('[cb] resizer elements missing');
      return;
    }

    // Force the row layout inline so no external CSS can override it.
    ws.style.display = 'flex';
    ws.style.flexDirection = 'row';
    chat.style.flex = '1 1 auto';
    chat.style.minWidth = '0';
    pane.style.flex = '0 0 auto';

    let dragging = false;

    resizer.addEventListener('mousedown', (e) => {
      dragging = true;
      resizer.classList.add('dragging');
      document.body.style.userSelect = 'none';
      e.preventDefault();
    });

    document.addEventListener('mousemove', (e) => {
      if (!dragging) return;
      const rect = ws.getBoundingClientRect();
      let w = rect.right - e.clientX;            // history pane is on the right
      const min = 220;
      const max = rect.width - 200;              // leave at least 200px for chat
      w = Math.max(min, Math.min(w, max));
      pane.style.width = w + 'px';
      pane.style.flexBasis = w + 'px';           // belt-and-suspenders
    });

    document.addEventListener('mouseup', () => {
      if (!dragging) return;
      dragging = false;
      resizer.classList.remove('dragging');
      document.body.style.userSelect = '';
    });
  })();

  // ─── boot ─────────────────────────────────────────────────────────────

  send({ type: 'requestState' });

})();
