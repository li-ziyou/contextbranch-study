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
    checkpoints: [],
    activeCheckpointId: null,
    apiCounterMode: 'total',   // 'total' | 'split' | 'none' (click the pill to cycle)
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
          setMergeUiBusy(false);
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
        case 'checkpointCreated':
          showStatus(msg.message || 'Checkpoint created.', 'success');
          break;
        case 'checkpointRestored':
          showStatus(msg.message || 'Checkpoint restored.', 'success');
          break;
        case 'proposedEdits': renderEditReview(msg.files); break;
        case 'editsApplied':
          clearEditReview();
          showStatus(
            `Applied edits to ${msg.applied} file${msg.applied === 1 ? '' : 's'}` +
            (msg.failures ? ` · ${msg.failures.length} change(s) skipped` : ''),
            msg.failures ? 'info' : 'success');
          break;
        case 'editsDiscarded':
          clearEditReview();
          showStatus('Proposed edits discarded.', 'info');
          break;
        case 'artifactsPreviewed': {
          if (msg.filesWithChanges > 0) {
            showPreviewBar(msg.filesWithChanges, msg.branchName);
          } else {
            hidePreviewBar();
            showStatus('No changes to preview — workspace already matches this branch.', 'info');
          }
          break;
        }
        case 'artifactsPreviewDismissed':
          hidePreviewBar();
          showStatus('Preview dismissed — files reverted.', 'info');
          break;
      }
    } catch (err) {
      showStatus('UI error: ' + err.message, 'error');
    }
  });

  // ─── handlers ─────────────────────────────────────────────────────────

  function clearEditReview() {
    const panel = $('edit-review');
    if (panel) { panel.hidden = true; panel.innerHTML = ''; }
  }

  // Render the proposed-edits review panel. Each file shows its diff; each
  // change (op) has a checkbox so you can accept a subset. Apply / Discard.
  function renderEditReview(files) {
    const panel = $('edit-review');
    if (!panel) return;
    panel.innerHTML = '';
    panel.hidden = false;

    const head = document.createElement('div');
    head.className = 'edit-review-head';
    head.textContent = 'Proposed changes — review, then apply';
    panel.appendChild(head);

    const body = document.createElement('div');
    body.className = 'edit-review-body';
    panel.appendChild(body);

    const addLines = (container, arr, type, more) => {
      for (const t of arr) {
        const line = document.createElement('div');
        line.className = 'dl dl-' + type;
        line.textContent = (type === 'add' ? '+ ' : type === 'del' ? '- ' : '  ') + t;
        container.appendChild(line);
      }
      if (more) {
        const m = document.createElement('div');
        m.className = 'dl dl-ctx';
        m.textContent = '  … +' + more + ' more line' + (more === 1 ? '' : 's');
        container.appendChild(m);
      }
    };

    for (const f of files) {
      const card = document.createElement('div');
      card.className = 'edit-file';
      card.dataset.path = f.path;

      const title = document.createElement('div');
      title.className = 'edit-file-title';
      const name = document.createElement('span');
      name.className = 'edit-file-path';
      name.textContent = f.path + (f.isNew ? '  (new file)' : '');
      title.appendChild(name);
      card.appendChild(title);

      f.ops.forEach(op => {
        const opBox = document.createElement('div');
        opBox.className = 'edit-op-box' + (op.ok ? '' : ' edit-op-failed');

        const row = document.createElement('label');
        row.className = 'edit-op-row';
        const cb = document.createElement('input');
        cb.type = 'checkbox';
        cb.checked = op.ok;
        cb.disabled = !op.ok;
        cb.dataset.index = String(op.index);
        row.appendChild(cb);
        const lbl = document.createElement('span');
        lbl.className = 'edit-op-label';
        lbl.textContent = op.ok
          ? (op.kind === 'create' ? (f.isNew ? 'Create this file' : 'Replace file contents')
                                  : 'Change ' + (op.index + 1))
          : 'Change ' + (op.index + 1) + ' — skipped';
        row.appendChild(lbl);
        opBox.appendChild(row);

        if (!op.ok && op.reason) {
          const why = document.createElement('div');
          why.className = 'edit-op-reason';
          why.textContent = op.reason;
          opBox.appendChild(why);
        }

        const diff = document.createElement('div');
        diff.className = 'edit-op-diff';
        addLines(diff, op.del.lines, 'del', op.del.more);
        addLines(diff, op.add.lines, 'add', op.add.more);
        if (op.del.lines.length || op.add.lines.length) opBox.appendChild(diff);

        card.appendChild(opBox);
      });

      body.appendChild(card);
    }

    const actions = document.createElement('div');
    actions.className = 'edit-review-actions';
    const discard = document.createElement('button');
    discard.className = 'btn-secondary';
    discard.textContent = 'Discard';
    discard.addEventListener('click', () => send({ type: 'discardProposedEdits' }));
    const apply = document.createElement('button');
    apply.className = 'btn-primary';
    apply.textContent = 'Apply selected';
    apply.addEventListener('click', () => {
      const accepted = {};
      panel.querySelectorAll('.edit-file').forEach(card => {
        const p = card.dataset.path;
        const idxs = [];
        card.querySelectorAll('input[type=checkbox]').forEach(cb => {
          if (cb.checked && !cb.disabled) idxs.push(Number(cb.dataset.index));
        });
        accepted[p] = idxs;
      });
      send({ type: 'applyProposedEdits', accepted });
    });
    actions.appendChild(discard);
    actions.appendChild(apply);
    panel.appendChild(actions);
  }

  function handleState(s) {
    const prevBranch = state.activeBranchId;
    state = Object.assign({}, state, s);
    // A branch switch supersedes any in-flight preview on the extension side,
    // so drop the bar to stay in sync.
    if (s.activeBranchId !== undefined && s.activeBranchId !== prevBranch) {
      hidePreviewBar();
    }
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
    setMergeUiBusy(false);
    closeModal('modal-merge');
    state.pendingMerge = null;
    state.pendingMergePreview = null;
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

    // Project-wide API call counter (workspace telemetry spans all branches).
    // Click cycles: total → user+merge split → hidden.
    const apiCounter = $('api-counter');
    const t = state.telemetry;
    if (apiCounter) {
      if (t && !state.noWorkspace) {
        const userCalls  = t.totalApiCalls || 0;
        const mergeCalls = t.totalMergeApiCalls || 0;
        const total = userCalls + mergeCalls;
        const valEl = $('api-counter-value');
        const mode = state.apiCounterMode || 'total';

        if (mode === 'none') {
          valEl.textContent = '';
          apiCounter.classList.add('api-counter-min');
        } else if (mode === 'split') {
          apiCounter.classList.remove('api-counter-min');
          valEl.innerHTML =
            `${userCalls.toLocaleString()}<span class="api-counter-merge">+${mergeCalls.toLocaleString()}</span>`;
        } else { // total
          apiCounter.classList.remove('api-counter-min');
          valEl.textContent = total.toLocaleString();
        }

        const inTok  = (t.totalInputTokens || 0).toLocaleString();
        const outTok = (t.totalOutputTokens || 0).toLocaleString();
        const mIn  = (t.totalMergeInputTokens || 0).toLocaleString();
        const mOut = (t.totalMergeOutputTokens || 0).toLocaleString();
        apiCounter.title =
          `API calls (click to change view)\n` +
          `• Your calls: ${userCalls.toLocaleString()}  (in ${inTok} / out ${outTok} tokens)\n` +
          `• Merge-engine calls: ${mergeCalls.toLocaleString()}  (in ${mIn} / out ${mOut} tokens)\n` +
          `• Total: ${total.toLocaleString()}`;
        apiCounter.hidden = false;
      } else {
        apiCounter.hidden = true;
      }
    }

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

    renderCheckpointModal();

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

  // A merge writes TWO snapshots onto the target branch: a "Pre-merge" and a
  // "Post-merge" checkpoint. Rather than invent a separate node (which used to
  // duplicate the target branch — e.g. three "main" nodes), we render the merge
  // INLINE on the target's lane: the Post-merge checkpoint becomes the merge
  // diamond, the Pre-merge checkpoint is folded away, and a dashed line runs
  // from the merged branch into that diamond.
  function checkpointKind(cp) {
    const l = (cp.label || '').toLowerCase();
    if (l.startsWith('fork point')) return 'fork';
    if (l.startsWith('pre-merge'))  return 'pre-merge';
    if (l.startsWith('post-merge')) return 'post-merge';
    return 'manual';
  }
  // Pre-merge snapshots are always folded out. Post-merge snapshots are NOT
  // hidden — they become the merge diamond. So the only truly hidden kind is
  // 'pre-merge'.
  function checkpointHidden(cp) {
    return checkpointKind(cp) === 'pre-merge';
  }
  // A manual / fork checkpoint that draws as a triangle.
  function isTriangleCheckpoint(cp) {
    const k = checkpointKind(cp);
    return k === 'manual' || k === 'fork';
  }
  function shortCheckpointLabel(cp) {
    if (checkpointKind(cp) === 'fork') {
      const after = (cp.label || '').split(':').slice(1).join(':').trim();
      return after || 'fork';
    }
    let l = cp.label || 'checkpoint';
    // Collapse the occasional runaway auto-save label.
    l = l.replace(/^(Auto-saved before switch).*/i, 'Auto-saved before switch');
    return l;
  }

  /**
   * Build the visual graph.
   *
   * Node kinds:
   *   • branch     — a branch's identity / head        (filled circle)
   *   • checkpoint — a manual or fork snapshot          (filled triangle)
   *   • merge      — a completed merge (post-merge cp)   (filled diamond)
   *
   * Tree edges (define the layout, drawn solid):
   *   • a checkpoint/merge hangs under its parent checkpoint on the same branch
   *     (hidden pre-merge ancestors are skipped), or under its branch node if
   *     it's that branch's first snapshot.
   *   • a branch node hangs under the fork-point checkpoint it forked from.
   *
   * Overlay edge (dashed, NOT part of the layout):
   *   • the merged branch's tip → the merge diamond.
   */
  function buildGraphModel(hg) {
    const nodes = [];
    const edges = [];
    const branchMap = new Map(hg.branches.map(b => [b.id, b]));
    const cpById = new Map((hg.checkpoints || []).map(c => [c.id, c]));
    const mergeEvents = (hg.mergeEvents || [])
      .slice()
      .sort((a, b) => (a.completedAt || a.startedAt || 0) - (b.completedAt || b.startedAt || 0));

    // Match each merge event to its Post-merge checkpoint on the target.
    // (finalizeMerge labels it `Post-merge of <sourceName>`.)
    const eventByPostMergeCpId = new Map(); // cpId -> mergeEvent
    for (const m of mergeEvents) {
      const sourceName = branchMap.get(m.sourceBranchId)?.name || m.sourceBranchId;
      const want = ('post-merge of ' + sourceName).toLowerCase();
      let best = null;
      for (const cp of (hg.checkpoints || [])) {
        if (cp.branchId !== m.targetBranchId) continue;
        if (checkpointKind(cp) !== 'post-merge') continue;
        if ((cp.label || '').toLowerCase() !== want) continue;
        const dt = Math.abs((cp.createdAt || 0) - (m.completedAt || m.startedAt || 0));
        if (!best || dt < best.dt) best = { cp, dt };
      }
      if (best) eventByPostMergeCpId.set(best.cp.id, m);
    }

    const nodeKindForCp = (cp) =>
      checkpointKind(cp) === 'post-merge' ? 'merge' : 'checkpoint';

    // Which checkpoints get a node? Triangles (manual/fork) + post-merge (diamond).
    const visibleCp = (cp) => !checkpointHidden(cp);

    // 1. Branch nodes
    for (const b of hg.branches) {
      nodes.push({ id: 'br:' + b.id, kind: 'branch', label: b.name, branch: b, createdAt: b.createdAt });
    }

    // 2. Checkpoint + merge nodes
    for (const cp of (hg.checkpoints || [])) {
      if (!visibleCp(cp)) continue;
      const k = nodeKindForCp(cp);
      if (k === 'merge') {
        const ev = eventByPostMergeCpId.get(cp.id);
        nodes.push({
          id: 'cp:' + cp.id,
          kind: 'merge',
          label: '',                              // diamonds stay text-free (tooltip only)
          checkpoint: cp,
          mergeEvent: ev || null,
          sourceBranchId: ev ? ev.sourceBranchId : null,
          sourceBranchName: ev ? (branchMap.get(ev.sourceBranchId)?.name || ev.sourceBranchId) : '',
          targetBranchId: cp.branchId,
          targetBranchName: branchMap.get(cp.branchId)?.name || cp.branchId,
          branchId: cp.branchId,
          createdAt: cp.createdAt,
        });
      } else {
        nodes.push({
          id: 'cp:' + cp.id,
          kind: 'checkpoint',
          label: shortCheckpointLabel(cp),
          checkpoint: cp,
          cpKind: checkpointKind(cp),
          branchId: cp.branchId,
          createdAt: cp.createdAt,
        });
      }
    }

    // 2b. Tree-parent of a checkpoint/merge node: climb parentCheckpointId,
    //     skipping hidden (pre-merge) ancestors; route a branch's first
    //     snapshot through its own branch node.
    function checkpointParentNode(cp) {
      let climb = cp.parentCheckpointId;
      while (climb) {
        const pc = cpById.get(climb);
        if (!pc) break;
        if (pc.branchId !== cp.branchId) return 'br:' + cp.branchId;
        if (visibleCp(pc)) return 'cp:' + pc.id;
        climb = pc.parentCheckpointId;
      }
      return 'br:' + cp.branchId;
    }
    for (const cp of (hg.checkpoints || [])) {
      if (!visibleCp(cp)) continue;
      edges.push({ from: checkpointParentNode(cp), to: 'cp:' + cp.id, kind: 'mainline' });
    }

    // 3. Fork edges: a branch node hangs under its fork-point checkpoint.
    for (const b of hg.branches) {
      if (!b.parentBranchId) continue;
      let parentNodeId = 'br:' + b.parentBranchId;
      const fc = b.parentCheckpointId ? cpById.get(b.parentCheckpointId) : null;
      if (fc && visibleCp(fc)) parentNodeId = 'cp:' + fc.id;
      edges.push({ from: parentNodeId, to: 'br:' + b.id, kind: 'fork' });
    }

    // 4. Merge overlay edges: merged branch's tip → the merge diamond (dashed).
    //    The "tip" is the deepest visible node on the source branch at merge time.
    function sourceTipNode(sourceBranchId, when) {
      let best = null;
      for (const cp of (hg.checkpoints || [])) {
        if (cp.branchId !== sourceBranchId) continue;
        if (!visibleCp(cp)) continue;
        if ((cp.createdAt || 0) > when + 5) continue; // small slack
        if (!best || (cp.createdAt || 0) >= (best.createdAt || 0)) best = cp;
      }
      return best ? 'cp:' + best.id : ('br:' + sourceBranchId);
    }
    for (const [cpId, m] of eventByPostMergeCpId.entries()) {
      const when = m.completedAt || m.startedAt || 0;
      edges.push({
        from: sourceTipNode(m.sourceBranchId, when),
        to: 'cp:' + cpId,
        kind: 'merge',
      });
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
// Visual radius per node kind — used for both drawing and edge trimming so
// arrowheads land just outside each shape regardless of its size.
function nodeRadius(n) {
  if (!n) return 14;
  if (n.kind === 'checkpoint') return 9;
  if (n.kind === 'merge') return 10;
  return 14; // branch
}

// ────────────────────────────────────────────────────────────────────────────
// Git-graph style layout.
//
// • X = column (lane). Each "line of development" gets its own column.
// • Y = chronological order of nodes (time flows downward).
// • A node stays in its parent's column if it's the parent's *primary*
//   same-branch child (the one whose work reaches furthest in time = the live
//   spine). Every other child opens a new column — this peels off both real
//   forks AND reset-orphaned lines (e.g. CP2 after you reset main to CP1).
// • Merges curve back into the target's spine (dashed overlay edge).
// ────────────────────────────────────────────────────────────────────────────
function layoutGraph(model) {
  const LANE_W = 88;
  const ROW_H = 52;
  const PAD_X = 40;
  const PAD_Y = 38;
  const LABEL_PAD = 140; // room for labels to the right of the last lane

  const nodeById = new Map(model.nodes.map(n => [n.id, n]));
  const childrenOf = new Map(model.nodes.map(n => [n.id, []]));
  const parentOf = new Map();

  for (const e of model.edges) {
    if (e.kind === 'merge') continue;            // overlay, not a layout edge
    if (!nodeById.has(e.from) || !nodeById.has(e.to)) continue;
    childrenOf.get(e.from).push(e.to);
    parentOf.set(e.to, e.from);
  }

  const branchIdOf = (n) => (n.kind === 'branch' ? n.branch.id : n.branchId);
  const sameBranch = (a, b) => a && b && branchIdOf(a) === branchIdOf(b);

  const cmpTime = (a, b) =>
    ((nodeById.get(a).createdAt || 0) - (nodeById.get(b).createdAt || 0)) ||
    String(a).localeCompare(String(b));

  // Furthest-in-time descendant of each node (picks the spine-continuing child).
  const subtreeMax = new Map();
  function calcMax(id) {
    if (subtreeMax.has(id)) return subtreeMax.get(id);
    let m = nodeById.get(id).createdAt || 0;
    for (const c of childrenOf.get(id)) m = Math.max(m, calcMax(c));
    subtreeMax.set(id, m);
    return m;
  }
  for (const n of model.nodes) calcMax(n.id);

  const roots = model.nodes.filter(n => !parentOf.has(n.id)).map(n => n.id).sort(cmpTime);

  // Column assignment (DFS). Primary child keeps the column; others get new ones.
  const colOf = new Map();
  let nextCol = -1;
  function assignCols(id, col) {
    colOf.set(id, col);
    const node = nodeById.get(id);
    const kids = childrenOf.get(id).slice().sort(cmpTime);
    let primary = null;
    for (const k of kids) {
      if (!sameBranch(nodeById.get(k), node)) continue;
      if (primary === null || subtreeMax.get(k) > subtreeMax.get(primary)) primary = k;
    }
    for (const k of kids) assignCols(k, k === primary ? col : ++nextCol);
  }
  for (const r of roots) assignCols(r, ++nextCol);

  // Rows: global chronological order (a parent always precedes its children).
  const ordered = model.nodes.map(n => n.id).sort(cmpTime);
  const rowOf = new Map();
  ordered.forEach((id, i) => rowOf.set(id, i));

  const numCols = nextCol + 1;
  const numRows = ordered.length;

  const positioned = model.nodes.map(n => Object.assign({}, n, {
    x: PAD_X + (colOf.get(n.id) || 0) * LANE_W,
    y: PAD_Y + (rowOf.get(n.id) || 0) * ROW_H,
    col: colOf.get(n.id) || 0,
    row: rowOf.get(n.id) || 0,
  }));
  const posById = new Map(positioned.map(n => [n.id, n]));

  const positionedEdges = [];
  for (const e of model.edges) {
    const from = posById.get(e.from), to = posById.get(e.to);
    if (!from || !to) continue;
    const le = buildLaneEdge(from, to);
    positionedEdges.push({
      kind: e.kind,
      type: e.kind === 'merge' ? 'merge' : (e.kind === 'fork' ? 'fork' : 'parent'),
      pathData: le.d,
      arrow: { x: le.mx, y: le.my, deg: le.deg },
    });
  }

  return {
    nodes: positioned,
    edges: positionedEdges,
    width: PAD_X * 2 + Math.max(0, numCols - 1) * LANE_W + LABEL_PAD,
    height: PAD_Y * 2 + Math.max(0, numRows - 1) * ROW_H,
  };
}

// Vertical inside a lane; smooth S-curve when crossing lanes (fork / merge).
// Returns the path plus the midpoint + tangent angle so the renderer can place
// a direction arrow ON the line (not buried under the target node).
function buildLaneEdge(from, to) {
  const fr = nodeRadius(from), tr = nodeRadius(to);
  const x1 = from.x, x2 = to.x;
  const y1 = from.y + fr;
  const y2 = to.y - tr - 5;

  if (Math.abs(x1 - x2) < 0.5) {
    const my = (y1 + y2) / 2;
    return { d: `M ${x1} ${y1} L ${x1} ${y2}`, mx: x1, my, deg: (y2 >= y1 ? 90 : -90) };
  }
  // Cubic: P0=(x1,y1) P1=(x1,cy) P2=(x2,cy) P3=(x2,y2)
  const cy = (y1 + y2) / 2;
  const mx = (x1 + x2) / 2;                       // point at t=0.5
  const my = (y1 + y2) / 2;
  const dx = 2 * (x2 - x1), dy = (y2 - y1);        // tangent ∝ (P2+P3)-(P0+P1)
  const deg = Math.atan2(dy, dx) * 180 / Math.PI;
  return { d: `M ${x1} ${y1} C ${x1} ${cy}, ${x2} ${cy}, ${x2} ${y2}`, mx, my, deg };
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
  const ARROW_CLEARANCE = 5;
  const fromR = nodeRadius(from);
  const toR = nodeRadius(to);

  // Calculate the distance and angle between the two nodes
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const angle = Math.atan2(dy, dx);

  // Start the line just outside the parent shape
  const startX = from.x + Math.cos(angle) * fromR;
  const startY = from.y + Math.sin(angle) * fromR;

  // Stop the line just above the child shape (leaving room for the arrow)
  const endX = to.x - Math.cos(angle) * (toR + ARROW_CLEARANCE);
  const endY = to.y - Math.sin(angle) * (toR + ARROW_CLEARANCE);

  return `M ${startX} ${startY} L ${endX} ${endY}`;
}
function renderGraph(g) {
  const SVG_NS = 'http://www.w3.org/2000/svg';
  const svg = $('history-svg');
  const container = $('history-graph-container');

  svg.innerHTML = '';

  // --------------------------------------------------
  // SVG sizing — the SVG fills the container; all zoom/pan happens through
  // the camera transform. This avoids the old "max-width:100%" squish that
  // shrank wide graphs to nothing in a narrow sidebar.
  // --------------------------------------------------

  const cw = (container && container.clientWidth)  || 320;
  const ch = (container && container.clientHeight) || 480;
  svg.setAttribute('width', '100%');
  svg.setAttribute('height', '100%');
  svg.setAttribute('viewBox', `0 0 ${cw} ${ch}`);
  svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');

  // --------------------------------------------------
  // Camera group
  // --------------------------------------------------

  const camera = document.createElementNS(SVG_NS, 'g');
  camera.setAttribute('class', 'graph-camera');
  svg.appendChild(camera);

  // --------------------------------------------------
  // Zoom + pan state — start fit-to-view so the whole tree is visible.
  // --------------------------------------------------

  const fitScale = Math.min(
    cw / Math.max(g.width, 1),
    ch / Math.max(g.height, 1),
    1.1
  );
  let scale = Math.max(0.3, fitScale || 1);
  let panX = (cw - g.width * scale) / 2;
  let panY = Math.max(12, (ch - g.height * scale) / 2);

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
  // Corner navigation controls
  // --------------------------------------------------

  const PAN_STEP = 80;
  const ZOOM_F   = 1.3;

  function bindGC(id, fn) {
    const el = document.getElementById(id);
    if (el) { el.onclick = (e) => { e.stopPropagation(); fn(); }; }
  }

  bindGC('gc-zoom-in',   () => { scale = Math.min(scale * ZOOM_F, 4);   updateCamera(); });
  bindGC('gc-zoom-out',  () => { scale = Math.max(scale / ZOOM_F, 0.2); updateCamera(); });
  bindGC('gc-reset',     () => {
    scale = Math.max(0.3, fitScale || 1);
    panX = (cw - g.width * scale) / 2;
    panY = Math.max(12, (ch - g.height * scale) / 2);
    updateCamera();
  });
  bindGC('gc-pan-up',    () => { panY += PAN_STEP; updateCamera(); });
  bindGC('gc-pan-down',  () => { panY -= PAN_STEP; updateCamera(); });
  bindGC('gc-pan-left',  () => { panX += PAN_STEP; updateCamera(); });
  bindGC('gc-pan-right', () => { panX -= PAN_STEP; updateCamera(); });

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

  // Soft cyan glow used to mark the current node (no more mismatched ring).
  const glow = document.createElementNS(SVG_NS, 'filter');
  glow.setAttribute('id', 'activeGlow');
  glow.setAttribute('x', '-60%');
  glow.setAttribute('y', '-60%');
  glow.setAttribute('width', '220%');
  glow.setAttribute('height', '220%');
  const ds = document.createElementNS(SVG_NS, 'feDropShadow');
  ds.setAttribute('dx', '0');
  ds.setAttribute('dy', '0');
  ds.setAttribute('stdDeviation', '3.5');
  ds.setAttribute('flood-color', '#4FC3F7');
  ds.setAttribute('flood-opacity', '0.95');
  glow.appendChild(ds);
  defs.appendChild(glow);

  svg.appendChild(defs);

  // --------------------------------------------------
  // Draw edges FIRST
  // --------------------------------------------------

for (const e of g.edges) {
  const path = document.createElementNS(SVG_NS, 'path');
  path.setAttribute('d', e.pathData);
  path.style.setProperty('fill', 'none', 'important');
  let col;
  if (e.type === 'merge') {
    col = '#a779c9';
    path.setAttribute('stroke-dasharray', '4,4');
    path.style.setProperty('stroke-width', '1.6', 'important');
    path.setAttribute('opacity', '0.75');
  } else if (e.type === 'fork') {
    col = '#6f9bd1';
    path.style.setProperty('stroke-width', '2', 'important');
    path.setAttribute('opacity', '0.85');
  } else {
    col = 'var(--vscode-descriptionForeground, #888)';
    path.style.setProperty('stroke-width', '1.6', 'important');
    path.setAttribute('opacity', '0.6');
  }
  path.style.setProperty('stroke', col, 'important');
  camera.appendChild(path);

  // Direction arrow placed ON the line at its midpoint (so it's never hidden
  // behind the target node). A→▶→B.
  if (e.arrow) {
    const tri = document.createElementNS(SVG_NS, 'polygon');
    tri.setAttribute('points', '-3.5,-4 5,0 -3.5,4');
    tri.setAttribute('transform', `translate(${e.arrow.x}, ${e.arrow.y}) rotate(${e.arrow.deg})`);
    tri.style.setProperty('fill', col, 'important');
    tri.style.setProperty('stroke', 'none', 'important');
    tri.setAttribute('opacity', e.type === 'merge' ? '0.9' : '0.85');
    camera.appendChild(tri);
  }
}

  // --------------------------------------------------
  // Draw nodes SECOND
  // --------------------------------------------------

  const activeCpId = state.activeCheckpointId || null;

  // Deliberate, theme-independent palette so nodes are actually COLORED
  // (the old near-black branch fill just vanished into the background).
  const PAL = {
    branchActive:  { fill: '#4FC3F7', stroke: '#e3f5fd' },
    branchIdle:    { fill: '#566179', stroke: '#aeb7c9' },
    manual:        { fill: '#e0a44b', stroke: '#8a6312' },
    fork:          { fill: '#6f9bd1', stroke: '#2f496b' },
    merge:         { fill: '#a779c9', stroke: '#6b3f87' },
  };

  for (const n of g.nodes) {
    const group = document.createElementNS(SVG_NS, 'g');
    group.style.cursor = 'pointer';
    group.setAttribute('class', 'graph-node');

    const r = nodeRadius(n);
    let shape;
    let isActive = false;
    let labelText = '';
    let showLabel = false;
    let pal;

    if (n.kind === 'merge') {
      shape = document.createElementNS(SVG_NS, 'polygon');
      const d = r;
      shape.setAttribute('points',
        `${n.x},${n.y - d} ${n.x + d},${n.y} ${n.x},${n.y + d} ${n.x - d},${n.y}`);
      pal = PAL.merge;
      isActive = !!activeCpId && n.checkpoint && n.checkpoint.id === activeCpId;
      // diamonds carry no text — meaning comes from the dashed line + tooltip
      showLabel = false;

    } else if (n.kind === 'checkpoint') {
      shape = document.createElementNS(SVG_NS, 'polygon');
      const h = r * 1.2;
      shape.setAttribute('points',
        `${n.x},${n.y - h} ${n.x + r},${n.y + r * 0.85} ${n.x - r},${n.y + r * 0.85}`);
      pal = n.cpKind === 'fork' ? PAL.fork : PAL.manual;
      isActive = !!activeCpId && n.checkpoint.id === activeCpId;
      // Only user-named (manual) checkpoints get a text label; fork points are
      // self-explanatory by color/shape (keeps the canvas calm).
      labelText = n.label;
      showLabel = n.cpKind === 'manual';

    } else {
      shape = document.createElementNS(SVG_NS, 'circle');
      shape.setAttribute('cx', n.x);
      shape.setAttribute('cy', n.y);
      shape.setAttribute('r', r);
      isActive = n.branch.id === state.activeBranchId;
      pal = isActive ? PAL.branchActive : PAL.branchIdle;
      labelText = n.label;
      showLabel = true;
    }

    // Set as IMPORTANT inline styles. A stylesheet `fill:` always beats an SVG
    // fill attribute, and there are legacy `.graph-node {fill:...}` rules around,
    // so inline-important is the only way to guarantee the color sticks.
    shape.style.setProperty('fill', pal.fill, 'important');
    shape.style.setProperty('stroke', isActive ? '#4FC3F7' : pal.stroke, 'important');
    shape.style.setProperty('stroke-width', isActive ? '2.5' : '1.4', 'important');
    if (isActive) shape.setAttribute('filter', 'url(#activeGlow)');
    group.appendChild(shape);

    if (showLabel && labelText) {
      const text = document.createElementNS(SVG_NS, 'text');
      text.setAttribute('x', n.x + r + 7);
      text.setAttribute('y', n.y + 4);
      text.setAttribute('fill', 'var(--vscode-editor-foreground)');
      text.setAttribute('font-size', n.kind === 'branch' ? '12' : '10.5');
      text.setAttribute('paint-order', 'stroke');
      text.setAttribute('stroke', 'var(--vscode-editor-background, #1e1e1e)');
      text.setAttribute('stroke-width', '3');
      if (n.kind !== 'branch') text.setAttribute('opacity', '0.9');
      text.textContent = truncate(labelText, n.kind === 'branch' ? 18 : 14);
      group.appendChild(text);
    }

    const title = document.createElementNS(SVG_NS, 'title');
    title.textContent = tooltipFor(n);
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
    const kind = n.cpKind || 'manual';
    return `Checkpoint (${kind})\n${cp.label || '(no label)'}\n${when}\n${cp.messageIds?.length ?? 0} msgs · ${cp.artifactIds?.length ?? 0} files\nClick to switch here`;
  }
  if (n.kind === 'merge') {
    const ev = n.mergeEvent;
    const cp = n.checkpoint;
    const when = new Date((cp && cp.createdAt) || (ev && (ev.completedAt || ev.startedAt)) || 0).toLocaleString();
    if (ev) {
      return `Merge: ${n.sourceBranchName} → ${n.targetBranchName}\nStatus: ${ev.verification?.status || 'unknown'}${ev.verification?.forced ? ' (forced)' : ''}\n${when}\nClick for details`;
    }
    return `Merge into ${n.targetBranchName}\n${when}\nClick for details`;
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
  } else if (node.kind === 'checkpoint') {
    renderCheckpointCard(node, title, body);
  } else {
    title.textContent = 'Unknown';
    body.textContent = 'No details available.';
  }
}

/**
 * Card for a checkpoint node. The headline action is "switch here", which
 * means: move to this checkpoint's branch AND reset that branch to this
 * checkpoint's state. That is destructive, so we gate it behind an explicit
 * warning and offer to snapshot the current branch first.
 */
function renderCheckpointCard(node, title, body) {
  const cp = node.checkpoint;
  const kind = node.cpKind || 'manual';
  const branch = (state.historyGraph?.branches || []).find(b => b.id === cp.branchId);
  const branchName = branch ? branch.name : cp.branchId;
  const isActiveCp = state.activeCheckpointId && cp.id === state.activeCheckpointId;

  title.textContent = cp.label || `(${kind} checkpoint)`;

  appendP(body, `${kind} checkpoint on “${branchName}”`, 'muted');
  appendP(body, new Date(cp.createdAt || 0).toLocaleString(), 'muted');
  appendP(body, `${cp.messageIds?.length ?? 0} messages · ${cp.artifactIds?.length ?? 0} files`);

  if (isActiveCp) {
    appendP(body, '(this is the current state)', 'muted');
    return;
  }

  // Switch-to-this-checkpoint (branch + restore), gated by the irreversible warning.
  appendCpSwitch(body, cp, branchName);
}

/**
 * Append a "switch to this checkpoint" control + irreversible-warning flow.
 * Used by both checkpoint nodes and the pre/post-merge rows of a merge diamond.
 * `triggerLabel` overrides the button text (optional).
 */
function appendCpSwitch(body, cp, branchName, triggerLabel) {
  if (state.activeCheckpointId && cp.id === state.activeCheckpointId) {
    appendP(body, '↳ this is the current state', 'muted');
    return;
  }
  const switchBtn = document.createElement('button');
  switchBtn.className = 'btn-primary detail-switch-btn';
  switchBtn.textContent = triggerLabel ||
    (cp.branchId === state.activeBranchId ? 'Reset to this checkpoint' : 'Switch to this checkpoint');
  body.appendChild(switchBtn);

  switchBtn.addEventListener('click', () => {
    switchBtn.remove();

    const warn = document.createElement('div');
    warn.className = 'switch-warning';

    const head = document.createElement('div');
    head.className = 'switch-warning-head';
    head.textContent = '⚠ This is irreversible';
    warn.appendChild(head);

    const p = document.createElement('p');
    p.className = 'switch-warning-body';
    p.textContent =
      'Switching replaces “' + branchName + '”’s current state with this checkpoint. ' +
      'Anything after this point on that branch is dropped from the working state. ' +
      'If you want to keep your current progress, snapshot it first.';
    warn.appendChild(p);

    const optWrap = document.createElement('label');
    optWrap.className = 'switch-warning-opt';
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = false;   // off by default — opt in if you want a safety snapshot
    optWrap.appendChild(cb);
    const cbText = document.createElement('span');
    const activeBranch = (state.historyGraph?.branches || []).find(b => b.id === state.activeBranchId);
    cbText.textContent = 'Checkpoint my current branch (“' +
      (activeBranch ? activeBranch.name : state.activeBranchId) + '”) first';
    optWrap.appendChild(cbText);
    warn.appendChild(optWrap);

    const actions = document.createElement('div');
    actions.className = 'switch-warning-actions';

    const cancel = document.createElement('button');
    cancel.className = 'btn-secondary';
    cancel.textContent = 'Cancel';
    cancel.addEventListener('click', () => { $('history-detail').hidden = true; });

    const go = document.createElement('button');
    go.className = 'btn-danger';
    go.textContent = 'Switch now';
    go.addEventListener('click', () => {
      if (cb.checked && state.activeBranchId) {
        send({ type: 'createCheckpoint', branchId: state.activeBranchId, label: 'Auto-saved before switch' });
      }
      if (cp.branchId !== state.activeBranchId) {
        send({ type: 'switchBranch', branchId: cp.branchId });
      }
      send({ type: 'restoreCheckpoint', branchId: cp.branchId, checkpointId: cp.id });
      $('history-detail').hidden = true;
    });

    actions.appendChild(cancel);
    actions.appendChild(go);
    warn.appendChild(actions);
    body.appendChild(warn);
  });
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
  renderCheckpointSection(body, b.id, windowStart, windowEnd); // burasi iste bir sikinti var aslinda diye dusunuyorum

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
  const cp = node.checkpoint;
  const targetBranchId = node.targetBranchId || (ev && ev.targetBranchId) || (cp && cp.branchId);
  const sourceName = node.sourceBranchName || (ev && ev.sourceBranchId) || '(unknown)';
  const targetName = node.targetBranchName || (ev && ev.targetBranchId) || targetBranchId;
  const isActive = targetBranchId === state.activeBranchId;

  // Header
  title.textContent = `Merge → ${targetName}`;

  const thisMergeTime = (cp && cp.createdAt) || (ev && (ev.completedAt || ev.startedAt)) || 0;
  appendP(body, `${sourceName} → ${targetName}`);
  appendP(body, new Date(thisMergeTime).toLocaleString(), 'muted');

  if (ev) {
    const v = ev.verification || {};
    appendP(body, `Status: ${v.status || 'unknown'}${v.forced ? ' (forced)' : ''}`);
    if (ev.rebaseNotes && ev.rebaseNotes.length) {
      appendP(body, ev.rebaseNotes.join('; '), 'muted');
    }
  }

  if (isActive) {
    appendP(body, '(target branch is currently active)', 'muted');
  }

  // ── The two snapshots this merge produced on the target branch ──
  // The diamond IS the post-merge checkpoint; its parent is the pre-merge one.
  // Both are real checkpoints you can jump to — surfaced here since they have
  // no node of their own on the graph.
  const allCps = state.historyGraph?.checkpoints || [];
  const postCp = cp || null;
  const preCp = postCp ? allCps.find(c => c.id === postCp.parentCheckpointId) : null;

  const sec = document.createElement('div');
  sec.className = 'detail-section-header';
  sec.textContent = 'Merge snapshots';
  body.appendChild(sec);

  if (preCp) {
    appendP(body, `Pre-merge — ${targetName} just before absorbing ${sourceName}`, 'muted');
    appendP(body, `${preCp.artifactIds?.length ?? 0} files · ${preCp.messageIds?.length ?? 0} messages`);
    appendCpSwitch(body, preCp, targetName, 'Switch to pre-merge state');
  }
  if (postCp) {
    appendP(body, `Post-merge — ${targetName} after absorbing ${sourceName} (this diamond)`, 'muted');
    appendP(body, `${postCp.artifactIds?.length ?? 0} files · ${postCp.messageIds?.length ?? 0} messages`);
    appendCpSwitch(body, postCp, targetName, 'Switch to post-merge state');
  }

  // Switch to the target branch head (lands on its latest state).
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
  const cpKindOf = (cp) => {
    const l = (cp.label || '').toLowerCase();
    if (l.startsWith('fork point')) return 'fork';
    if (l.startsWith('pre-merge'))  return 'pre-merge';
    if (l.startsWith('post-merge')) return 'post-merge';
    return 'manual';
  };
  const inWindow = allCheckpoints
    .filter(cp => cp.branchId === branchId)
    // Only the snapshots the graph actually draws as triangles (manual + fork).
    // Pre/post-merge snapshots are represented by the merge diamond instead.
    .filter(cp => { const k = cpKindOf(cp); return k === 'manual' || k === 'fork'; })
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
    li.setAttribute('role', 'button');
    li.setAttribute('tabindex', '0');           // keyboard-focusable
    li.title = 'Switch to this checkpoint';

    const dot = document.createElement('span');
    dot.className = 'detail-checkpoint-dot ' + cpKindOf(cp);
    li.appendChild(dot);

    const main = document.createElement('div');
    main.className = 'detail-checkpoint-main';

    const label = document.createElement('div');
    label.className = 'detail-checkpoint-label';
    label.textContent = cp.label || `(${cpKindOf(cp)} checkpoint)`;
    main.appendChild(label);

    const meta = document.createElement('div');
    meta.className = 'detail-checkpoint-meta';
    const when = new Date(cp.createdAt || 0).toLocaleString();
    meta.textContent = `${when} · ${cp.messageIds.length} msgs · ${cp.artifactIds.length} files`;
    main.appendChild(meta);

    li.appendChild(main);

    // Whole row is the switch affordance.
    const doSwitch = () => {
      send({ type: 'restoreCheckpoint', branchId, checkpointId: cp.id });
      $('history-detail').hidden = true;
    };
    li.addEventListener('click', doSwitch);
    li.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); doSwitch(); }
    });

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

function appendSwitchButtonCheckpoint(parent, branchId, checkpointId) {
  const btn = document.createElement('button');
  btn.className = 'btn-primary detail-switch-btn';
  btn.textContent = 'Switch to this checkpoint';
  btn.addEventListener('click', () => {
    send({ type: 'restoreCheckpoint', branchId, checkpointId });
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


  function formatCheckpointTime(ts) {
    try {
      return new Date(ts).toLocaleString();
    } catch {
      return String(ts);
    }
  }

  function openCheckpointModal() {
    $('checkpoint-label').value = '';
    renderCheckpointModal();
    openModal('modal-checkpoint');
    $('checkpoint-label').focus();
  }

  function renderCheckpointModal() {
    const wrap = $('checkpoint-list');
    const summary = $('checkpoint-summary');
    const checkpoints = Array.isArray(state.checkpoints) ? state.checkpoints : [];
    const activeId = state.activeCheckpointId || null;

    if (summary) {
      summary.textContent = activeId
        ? `Current checkpoint: ${activeId.slice(0, 8)}`
        : 'No active checkpoint recorded yet.';
    }
    if (!wrap) return;
    wrap.innerHTML = '';

    if (checkpoints.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'decomp-warning';
      empty.textContent = 'No checkpoints yet. Create one to capture the current branch state.';
      wrap.appendChild(empty);
      return;
    }

    for (const cp of checkpoints.slice().reverse()) {
      const item = document.createElement('div');
      item.className = 'checkpoint-item' + (cp.id === activeId ? ' current' : '');

      const head = document.createElement('div');
      head.className = 'checkpoint-item-head';

      const title = document.createElement('div');
      title.className = 'checkpoint-item-title';
      title.innerHTML = `<strong>${escapeHtml(cp.label || ('Checkpoint ' + cp.id.slice(0, 8)))}</strong>` +
        (cp.id === activeId ? ' <span class="checkpoint-badge">current</span>' : '');
      head.appendChild(title);

      const restoreBtn = document.createElement('button');
      restoreBtn.className = 'btn-secondary';
      restoreBtn.textContent = cp.id === activeId ? 'Current' : 'Restore';
      restoreBtn.disabled = cp.id === activeId;
      restoreBtn.dataset.checkpointId = cp.id;
      restoreBtn.dataset.action = 'restore-checkpoint';
      head.appendChild(restoreBtn);
      item.appendChild(head);

      const meta = document.createElement('div');
      meta.className = 'checkpoint-item-meta';
      const parent = cp.parentCheckpointId ? cp.parentCheckpointId.slice(0, 8) : 'root';
      meta.textContent = `${formatCheckpointTime(cp.createdAt)} · parent ${parent} · ${cp.messageCount ?? 0} messages · ${cp.artifactCount ?? 0} artifacts`;
      item.appendChild(meta);

      wrap.appendChild(item);
    }
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
      cb.addEventListener('change', () => updateMergeActionButtons());
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

    updateMergeActionButtons();
    $('merge-preview-btn').hidden = true;
    setMergeUiBusy(false);
  }

  // ─── status / errors ─────────────────────────────────────────────────

  function showPreviewBar(fileCount, branchName) {
    const bar = $('preview-bar');
    const text = $('preview-bar-text');
    if (!bar) return;
    if (text) {
      const n = fileCount === 1 ? '1 file' : `${fileCount} files`;
      text.textContent = `Previewing changes to ${n}` +
        (branchName ? ` from "${branchName}"` : '') +
        '. Click a highlighted line to drop it.';
    }
    const apply = $('preview-apply');
    const dismiss = $('preview-dismiss');
    if (apply) apply.disabled = false;
    if (dismiss) dismiss.disabled = false;
    bar.hidden = false;
  }

  function hidePreviewBar() {
    const bar = $('preview-bar');
    if (bar) bar.hidden = true;
  }

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

  function setMergeUiBusy(busy) {
    const previewBtn = $('merge-preview-btn');
    const confirmBtn = $('merge-confirm');
    const forceBtn = $('merge-force');
    if (previewBtn) previewBtn.disabled = busy;
    if (confirmBtn) confirmBtn.disabled = busy;
    if (forceBtn) forceBtn.disabled = busy;
  }

  function updateMergeActionButtons() {
    const p = state.pendingMergePreview;
    if (!p) return;

    const accepted = collectAcceptedConflictResolutions();
    const unresolved = (p.verification.artifactConflicts || []).filter((c) => !accepted.includes(c.path));
    const testsFailed = !!(p.verification.testOutput && /FAIL:/i.test(p.verification.testOutput));
    const canFinalize = !testsFailed && unresolved.length === 0;

    $('merge-confirm').hidden = !canFinalize;
    $('merge-force').hidden = canFinalize;
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

  $('checkpoint-create').addEventListener('click', () => {
    if (!state.activeBranchId) {
      showStatus('Open a branch first.', 'error');
      return;
    }
    send({
      type: 'createCheckpoint',
      branchId: state.activeBranchId,
      label: $('checkpoint-label').value.trim() || undefined,
    });
    $('checkpoint-label').value = '';
    closeModal('modal-checkpoint');
  });

  $('checkpoint-list').addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-checkpoint-id]');
    if (!btn) return;
    const checkpointId = btn.dataset.checkpointId;
    if (!checkpointId || !state.activeBranchId) return;
    // const ok = confirm(`Restore branch to checkpoint ${checkpointId.slice(0, 8)}?`);
    // if (!ok) return; #sandboxed stuff, don't work!
    send({ type: 'restoreCheckpoint', branchId: state.activeBranchId, checkpointId });
    closeModal('modal-checkpoint');
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
    // All suggested branches must fork from the SAME base (the branch we're on
    // now) — not chain off each previous new branch. Pin the parent explicitly
    // and only switch to the first one.
    const base = state.activeBranchId;
    r.branches.forEach((b, i) => {
      send({ type: 'createBranch', name: b.name, description: b.scope,
             parentBranchId: base, select: i === 0 });
    });
    showStatus(`Created ${r.branches.length} branches from the current branch.`, 'success');
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
    setMergeUiBusy(false);
    openModal('modal-merge');
  }

  $('merge-preview-btn').addEventListener('click', () => {
    const target = $('merge-target-select').value;
    if (!target) {
      showStatus('Pick a target branch first.', 'error');
      return;
    }
    setMergeUiBusy(true);
    $('merge-running').hidden = false;
    send({
      type: 'previewMerge',
      sourceBranchId: state.activeBranchId,
      targetBranchId: target,
    });
  });

  $('merge-confirm').addEventListener('click', () => {
    if (!state.pendingMerge) return;
    setMergeUiBusy(true);
    $('merge-running').hidden = false;
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
    setMergeUiBusy(true);
    $('merge-running').hidden = false;
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

  // ─── preview Apply / Dismiss ───────────────────────────────────────────
  {
    const applyBtn = $('preview-apply');
    const dismissBtn = $('preview-dismiss');
    if (applyBtn) {
      applyBtn.addEventListener('click', () => {
        applyBtn.disabled = true;
        if (dismissBtn) dismissBtn.disabled = true;
        send({ type: 'applyArtifactsToWorkspace', branchId: state.activeBranchId });
        hidePreviewBar();
      });
    }
    if (dismissBtn) {
      dismissBtn.addEventListener('click', () => {
        applyBtn && (applyBtn.disabled = true);
        dismissBtn.disabled = true;
        send({ type: 'dismissArtifactsPreview', branchId: state.activeBranchId });
      });
    }
  }

  // ─── action menu ──────────────────────────────────────────────────────

  document.querySelectorAll('.menu-item').forEach((item) => {
    item.addEventListener('click', () => {
      const action = item.dataset.action;
      closeDropdown('action-menu');
      if (action === 'decompose') openDecomposeModal();
      else if (action === 'newBranch') openBranchModal();
      else if (action === 'checkpoint') openCheckpointModal();
      else if (action === 'merge') openMergeModal();
      else if (action === 'apply') {
        send({ type: 'applyArtifactsToWorkspace', branchId: state.activeBranchId });
      } else if (action === 'preview') {
        send({ type: 'previewArtifactsInWorkspace', branchId: state.activeBranchId });
        showStatus('Loading preview…', 'info');
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
  $('btn-checkpoint').addEventListener('click', (e) => {
    e.stopPropagation();
    openCheckpointModal();
  });

  const apiCounterEl = $('api-counter');
  if (apiCounterEl) {
    apiCounterEl.addEventListener('click', (e) => {
      e.stopPropagation();
      const order = ['total', 'split', 'none'];
      const i = order.indexOf(state.apiCounterMode || 'total');
      state.apiCounterMode = order[(i + 1) % order.length];
      render();
    });
  }
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
    // NOTE: these are set with 'important' priority because the page's inline
    // <style> block declares the same properties with !important — a plain
    // inline style would lose to it, which is exactly why dragging used to do
    // nothing.
    const imp = (el, prop, val) => el.style.setProperty(prop, val, 'important');
    imp(ws, 'display', 'flex');
    imp(ws, 'flex-direction', 'row');
    imp(chat, 'flex', '1 1 auto');
    imp(chat, 'min-width', '0');
    imp(pane, 'flex', '0 0 auto');

    let dragging = false;

    function applyWidth(w) {
      // Must win against `#history-pane { width: ...!important }`.
      imp(pane, 'width', w + 'px');
      imp(pane, 'max-width', 'none');
      imp(pane, 'flex-basis', w + 'px');
    }

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
      const min = 200;
      const max = rect.width - 180;              // leave room for chat
      w = Math.max(min, Math.min(w, max));
      applyWidth(w);
    });

    document.addEventListener('mouseup', () => {
      if (!dragging) return;
      dragging = false;
      resizer.classList.remove('dragging');
      document.body.style.userSelect = '';
      // Re-fit the graph to the new pane width.
      if (state.historyOpen && state.historyGraph) renderHistoryView();
    });

    // Keep the graph fitted when the whole sidebar is resized.
    let rzTimer = null;
    window.addEventListener('resize', () => {
      if (!state.historyOpen || !state.historyGraph) return;
      clearTimeout(rzTimer);
      rzTimer = setTimeout(renderHistoryView, 120);
    });
  })();

  // ─── boot ─────────────────────────────────────────────────────────────

  send({ type: 'requestState' });

})();