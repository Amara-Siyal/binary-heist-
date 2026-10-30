
/* BINARY HEIST - LIVE LEADERBOARD */
(() => {
  'use strict';

  let period = 'all';
  let caseId = 1;
  let allCases = false;
  let leaderboardData = [];

  const $ = (selector, parent = document) =>
    parent.querySelector(selector);

  const $$ = (selector, parent = document) =>
    Array.from(parent.querySelectorAll(selector));

  const table = $('main table');
  const tbody = table ? $('tbody', table) : null;
  const searchInput = $('input[placeholder*="SEARCH CALLSIGN"]');

  const filterSection = $$('main section').find(section =>
    /TODAY/i.test(section.textContent) &&
    /THIS WEEK/i.test(section.textContent) &&
    /ALL TIME/i.test(section.textContent)
  );

  const filterButtons = filterSection
    ? $$('button', filterSection)
    : [];

  const periodButtons = filterButtons.slice(0, 3);
  const caseButtons = filterButtons.slice(3, 7);

  const refreshButton = $$('button').find(button =>
    /REFRESH STANDINGS/i.test(button.textContent)
  );

  const exportButton = $$('button').find(button =>
    /EXPORT SYNDICATE DOSSIER/i.test(button.textContent)
  );

  const actionButtons = $$('button').filter(button =>
    /RETURN TO DECK|NEXT CASE/i.test(button.textContent)
  );

  const podium = table
    ? table.closest('.lg\\:col-span-8')
        ?.querySelector('.grid.grid-cols-1.md\\:grid-cols-3')
    : null;

  function escapeHTML(value) {
    return String(value ?? '').replace(/[&<>"']/g, char => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;'
    })[char]);
  }

  function getName(player) {
    return player.agent_name ||
      player.player_name ||
      player.callsign ||
      `OPERATIVE_${player.player_id ?? ''}`;
  }

  function getRank(player) {
    return player.rank_title || 'OPERATIVE';
  }

  // API best_time is expected to be in seconds.
  function formatTime(value) {
    if (value === null || value === undefined || value === '') {
      return '--:--.--';
    }

    const seconds = Number(value);

    if (!Number.isFinite(seconds)) {
      return String(value);
    }

    const minutes = Math.floor(seconds / 60);
    const remaining = (seconds % 60).toFixed(2).padStart(5, '0');

    return `${String(minutes).padStart(2, '0')}:${remaining}`;
  }

  function formatScore(value) {
    const score = Number(value);
    return Number.isFinite(score) ? score.toLocaleString() : '0';
  }

  function activateButton(buttons, selected) {
    buttons.forEach(button => {
      button.classList.remove(
        'bg-surface-container-high',
        'text-primary-container',
        'border-primary-container',
        'glow-terminal-green',
        'font-bold'
      );
      button.classList.add('text-outline');
    });

    if (selected) {
      selected.classList.remove('text-outline');
      selected.classList.add(
        'bg-surface-container-high',
        'text-primary-container',
        'border-primary-container',
        'glow-terminal-green',
        'font-bold'
      );
    }
  }

  async function loadLeaderboard() {
    if (!window.Heist ||
        typeof window.Heist.leaderboard !== 'function') {
      showError(
        'Heist API missing. Load /js/heist-api.js before leaderboard.js.'
      );
      return;
    }

    if (tbody) {
      tbody.innerHTML = `
        <tr>
          <td colspan="6" class="py-8 px-4 text-center text-secondary-container">
            CONNECTING TO SYNDICATE DATABASE...
          </td>
        </tr>`;
    }

    try {
      // Use the existing API function from heist-api.js.
      const result = await window.Heist.leaderboard(
        period,
        allCases ? undefined : caseId
      );

      leaderboardData = Array.isArray(result) ? result : [];

      renderTable();
      renderPodium();
      updateTelemetry();
    } catch (error) {
      console.error('Leaderboard API error:', error);
      showError(
        `DATABASE LINK FAILED: ${error.message}. Check that server.js is running.`
      );
    }
  }

  function showError(message) {
    if (tbody) {
      tbody.innerHTML = `
        <tr>
          <td colspan="6" class="py-8 px-4 text-center text-error">
            ${escapeHTML(message)}
          </td>
        </tr>`;
    }

    if (podium) {
      podium.innerHTML = `
        <div class="col-span-3 p-5 border border-error text-error">
          LEADERBOARD DATA UNAVAILABLE
        </div>`;
    }
  }

  function getFilteredPlayers() {
    const query = (searchInput?.value || '').trim().toLowerCase();

    return leaderboardData.filter(player =>
      getName(player).toLowerCase().includes(query) ||
      getRank(player).toLowerCase().includes(query)
    );
  }

  function renderTable() {
    if (!tbody) return;

    const players = getFilteredPlayers();

    if (players.length === 0) {
      tbody.innerHTML = `
        <tr>
          <td colspan="6" class="py-8 px-4 text-center text-on-surface-variant">
            NO WINNING OPERATIVES FOUND.
          </td>
        </tr>`;
      updateBuffer(0);
      return;
    }

    tbody.innerHTML = players.map((player, index) => {
      const position = Number(player.position || index + 1);
      const name = getName(player);
      const rank = getRank(player);

      let rankColor = 'text-outline';
      let scoreColor = 'text-on-surface';

      if (position === 1) {
        rankColor = 'text-amber-400';
        scoreColor = 'text-amber-400';
      } else if (position === 2) {
        rankColor = 'text-slate-300';
        scoreColor = 'text-slate-200';
      } else if (position === 3) {
        rankColor = 'text-amber-600';
        scoreColor = 'text-amber-500';
      }

      return `
        <tr class="hover:bg-surface-container-high/60 transition-colors">
          <td class="py-3.5 px-4 ${rankColor} font-bold">
            ${String(position).padStart(2, '0')}
          </td>

          <td class="py-3.5 px-4">
            <div class="font-bold text-on-surface">
              ${escapeHTML(name)}
            </div>
          </td>

          <td class="py-3.5 px-4 text-xs hidden sm:table-cell text-on-surface-variant">
            <span class="bg-surface-container-high border border-outline-variant px-2 py-0.5 font-mono">
              ${escapeHTML(rank)}
            </span>
          </td>

          <td class="py-3.5 px-4 text-center text-primary-container font-mono">
            —
          </td>

          <td class="py-3.5 px-4 text-right font-mono text-on-surface-variant">
            ${escapeHTML(formatTime(player.best_time))}
          </td>

          <td class="py-3.5 px-4 text-right font-bold font-mono ${scoreColor} text-base">
            ${escapeHTML(formatScore(player.best_score))}
          </td>
        </tr>`;
    }).join('');

    updateBuffer(players.length);
  }

  function renderPodium() {
    if (!podium) return;

    const players = leaderboardData.slice(0, 3);

    // Keep the original visual order: second, first, third.
    const cards = [
      { player: players[1], position: 2, medal: 'SILVER' },
      { player: players[0], position: 1, medal: 'WANTED NO. 1' },
      { player: players[2], position: 3, medal: 'BRONZE' }
    ];

    podium.innerHTML = cards.map(card => {
      const player = card.player;

      if (!player) {
        return `
          <div class="bg-surface-container-lowest border border-outline-variant p-4">
            <div class="text-headline-md text-outline font-bold">
              #${String(card.position).padStart(2, '0')}
            </div>
            <div class="my-4 text-sm text-on-surface-variant">
              NO QUALIFIED OPERATIVE
            </div>
          </div>`;
      }

      const first = card.position === 1;
      const second = card.position === 2;

      const wrapper = first
        ? 'bg-surface-container-low border-2 border-amber-500 glow-gold p-5'
        : second
          ? 'bg-surface-container-lowest border border-slate-400/40 p-4'
          : 'bg-surface-container-lowest border border-amber-800/60 p-4';

      const color = first
        ? 'text-amber-400'
        : second
          ? 'text-slate-300'
          : 'text-amber-600';

      return `
        <div class="${wrapper} flex flex-col justify-between relative">
          ${first ? `
            <div class="absolute -top-3 left-1/2 -translate-x-1/2 px-3.5 py-0.5 bg-amber-500 text-surface-container-lowest text-xs font-bold uppercase tracking-widest">
              WANTED NO. 1
            </div>` : ''}

          <div class="flex justify-between items-start ${first ? 'pt-1' : ''}">
            <span class="text-headline-md ${color} font-bold">
              #${String(card.position).padStart(2, '0')}
            </span>
            <span class="text-xs font-semibold px-2 py-0.5 border border-outline-variant ${color}">
              ${escapeHTML(first ? getRank(player) : card.medal)}
            </span>
          </div>

          <div class="my-4">
            <div class="text-xs font-semibold tracking-wider ${color}">
              ${first ? 'PRIME SUSPECT' : 'CALLSIGN'}
            </div>
            <div class="text-headline-sm text-on-surface font-bold tracking-wide mt-0.5">
              ${escapeHTML(getName(player))}
            </div>
            <div class="text-xs text-on-surface-variant mt-1">
              ${escapeHTML(getRank(player))}
            </div>
          </div>

          <div class="pt-3 border-t border-outline-variant flex justify-between items-center text-sm font-mono">
            <span class="${color}">
              ${escapeHTML(formatTime(player.best_time))}
            </span>
            <span class="${color} font-bold">
              ${escapeHTML(formatScore(player.best_score))} PTS
            </span>
          </div>
        </div>`;
    }).join('');
  }

  function updateBuffer(count) {
    const elements = $$('main div');

    const buffer = elements.find(element =>
      element.children.length === 1 &&
      /BUFFER: DISPLAYING/i.test(element.textContent)
    );

    if (buffer) {
      buffer.textContent =
        `BUFFER: DISPLAYING ${count ? 1 : 0}-${count} OF ${count} WINNING OPERATIVES`;
    }
  }

  function updateTelemetry() {
    // The current API doesn't return accuracy or global player analytics.
    // Avoid displaying fake accuracy values as real statistics.
    const sidebar = $$('main div').find(element =>
      /OPERATIVE TELEMETRY/i.test(element.textContent)
    );

    if (!sidebar) return;

    const statBoxes = $$('.grid.grid-cols-2 > div', sidebar);
    if (statBoxes.length >= 4) {
      statBoxes[0].querySelector('.text-headline-sm')?.replaceChildren(
        document.createTextNode(
          leaderboardData.length ? `#${leaderboardData[0].position || 1}` : '—'
        )
      );

      const currentPlayer = window.Heist?.player?.();
      const currentName = currentPlayer?.agent_name;

      if (currentName) {
        const nameNode = $$('.text-headline-sm', sidebar).find(node =>
          node.textContent.includes('AGENT_C_0101')
        );

        if (nameNode) nameNode.textContent = currentName;
      }

      // The API doesn't provide accuracy, so don't invent a percentage.
      const accuracyBox = statBoxes.find(box =>
        /ACCURACY RATIO/i.test(box.textContent)
      );

      if (accuracyBox) {
        const value = $('.text-sm', accuracyBox);
        if (value) value.textContent = 'N/A';
      }
    }
  }

  // Period filters
  if (periodButtons.length >= 3) {
    periodButtons[0].addEventListener('click', () => {
      period = 'today';
      activateButton(periodButtons, periodButtons[0]);
      loadLeaderboard();
    });

    periodButtons[1].addEventListener('click', () => {
      period = 'week';
      activateButton(periodButtons, periodButtons[1]);
      loadLeaderboard();
    });

    periodButtons[2].addEventListener('click', () => {
      period = 'all';
      activateButton(periodButtons, periodButtons[2]);
      loadLeaderboard();
    });
  }

  // Case filters: assumes database case IDs 1, 2 and 3.
  if (caseButtons.length >= 4) {
    caseButtons[0].addEventListener('click', () => {
      allCases = true;
      activateButton(caseButtons, caseButtons[0]);
      loadLeaderboard();
    });

    caseButtons[1].addEventListener('click', () => {
      allCases = false;
      caseId = 1;
      activateButton(caseButtons, caseButtons[1]);
      loadLeaderboard();
    });

    caseButtons[2].addEventListener('click', () => {
      allCases = false;
      caseId = 2;
      activateButton(caseButtons, caseButtons[2]);
      loadLeaderboard();
    });

    caseButtons[3].addEventListener('click', () => {
      allCases = false;
      caseId = 3;
      activateButton(caseButtons, caseButtons[3]);
      loadLeaderboard();
    });
  }

  if (searchInput) {
    searchInput.addEventListener('input', renderTable);
  }

  if (refreshButton) {
    refreshButton.addEventListener('click', () => {
      if (searchInput) searchInput.value = '';
      loadLeaderboard();
    });
  }

  if (exportButton) {
    exportButton.addEventListener('click', () => {
      const players = getFilteredPlayers();

      const csvCell = value =>
        `"${String(value ?? '').replace(/"/g, '""')}"`;

      const csv = [
        ['Rank', 'Callsign', 'Specialty', 'Best Time (seconds)', 'Best Score', 'Wins'],
        ...players.map((player, index) => [
          player.position || index + 1,
          getName(player),
          getRank(player),
          player.best_time ?? '',
          player.best_score ?? '',
          player.wins ?? ''
        ])
      ].map(row => row.map(csvCell).join(',')).join('\r\n');

      const blob = new Blob([csv], {
        type: 'text/csv;charset=utf-8;'
      });

      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');

      link.href = url;
      link.download = 'binary-heist-leaderboard.csv';

      document.body.appendChild(link);
      link.click();
      link.remove();

      URL.revokeObjectURL(url);
    });
  }

  if (actionButtons.length >= 2) {
    actionButtons.find(button =>
      /RETURN TO DECK/i.test(button.textContent)
    )?.addEventListener('click', () => {
      window.location.href = '/index.html';
    });

    actionButtons.find(button =>
      /NEXT CASE/i.test(button.textContent)
    )?.addEventListener('click', () => {
      window.location.href = '/case-select.html';
    });
  }

  // Mobile navigation links
  const mobileNav = $('nav.md\\:hidden');

  if (mobileNav) {
    const links = $$('a', mobileNav);
    const destinations = [
      '/index.html',
      '/evidence.html',
      '/leaderboard.html',
      '/puzzle.html'
    ];

    links.forEach((link, index) => {
      if (destinations[index]) link.href = destinations[index];
    });
  }

  loadLeaderboard();
})();
