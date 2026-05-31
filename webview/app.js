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

  // ─── boot ─────────────────────────────────────────────────────────────

  send({ type: 'requestState' });

})();
