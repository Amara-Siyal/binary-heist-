
(function () {
  'use strict';

  const $ = (selector) => document.querySelector(selector);

  async function loadVictoryData() {
    try {
      const data = await Heist.state();

      const score = $('#final-score');
      const lives = $('#final-lives');
      const time = $('#final-time');

      if (score) {
        score.textContent = Number(data.score || 0).toLocaleString();
      }

      if (lives) {
        lives.textContent = data.lives_left ?? '--';
      }

      if (time) {
        const seconds = data.summary?.time_taken_sec;

        if (seconds !== undefined && seconds !== null &&
            Number.isFinite(Number(seconds))) {
          const total = Math.max(0, Math.floor(Number(seconds)));
          const minutes = Math.floor(total / 60);
          const remainder = total % 60;

          time.textContent =
            String(minutes).padStart(2, '0') + ':' +
            String(remainder).padStart(2, '0');
        } else {
          time.textContent = '--:--';
        }
      }
    } catch (error) {
      console.error('Could not load victory data:', error);
    }
  }

  function bindButtons() {
    document.querySelectorAll('button').forEach((button) => {
      const text = button.textContent.toLowerCase();

      if (text.includes('replay case')) {
        button.addEventListener('click', () => {
          location.href = '/case-select.html';
        });
      } else if (text.includes('view leaderboard')) {
        button.addEventListener('click', () => {
          location.href = '/deck.html';
        });
      } else if (text.includes('next case')) {
        button.addEventListener('click', () => {
          location.href = '/case-select.html';
        });
      }
    });
  }

  document.addEventListener('DOMContentLoaded', () => {
    bindButtons();
    loadVictoryData();
  });
})();
