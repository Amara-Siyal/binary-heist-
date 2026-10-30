
document.addEventListener("DOMContentLoaded", () => {
  const $ = (selector) => document.querySelector(selector);
  const $$ = (selector) => [...document.querySelectorAll(selector)];

  const formatNumber = (value) =>
    Number(value || 0).toLocaleString("en-US");

  const formatTime = (seconds) => {
    if (seconds == null || !Number.isFinite(Number(seconds))) {
      return "--";
    }

    const total = Math.max(0, Number(seconds));
    const minutes = Math.floor(total / 60);
    const secs = Math.floor(total % 60);

    return `${String(minutes).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
  };

  const setText = (element, value) => {
    if (element) element.textContent = value;
  };

  function showMessage(message) {
    let box = $("#analytics-message");

    if (!box) {
      box = document.createElement("div");
      box.id = "analytics-message";
      box.className =
        "bg-surface-container border border-outline-variant p-4 text-secondary-container text-sm";

      const main = $("main");
      if (main) main.prepend(box);
    }

    setText(box, message);
  }

  function getPlayer() {
    try {
      // Heist is declared in heist-api.js with a top-level const.
      return typeof Heist !== "undefined" ? Heist.player() : null;
    } catch {
      return null;
    }
  }

  function findValue(label) {
    const elements = $$("main span, main p, main h1, main h2");

    const target = elements.find((el) =>
      el.textContent.trim().toLowerCase().includes(label.toLowerCase())
    );

    return target || null;
  }

  function updateProfile(player) {
    if (!player) return;

    const heading = $("main h1");
    if (heading && player.agent_name) {
      setText(heading, player.agent_name);
    }

    // Update the profile's rank text if the API provides it.
    const rank = player.rank_title;
    if (rank) {
      const paragraphs = $$("main p");
      const profileParagraph = paragraphs.find((p) =>
        p.textContent.includes("Chief Forensic Cryptographer")
      );

      if (profileParagraph) {
        const rankSpan = [...profileParagraph.querySelectorAll("span")]
          .find((span) => span.textContent.includes("Chief Forensic Cryptographer"));

        if (rankSpan) setText(rankSpan, rank);
      }
    }
  }

  function updateSummary(data) {
    if (!data || typeof data !== "object") return;

    // Supports common analytics response shapes.
    const stats = data.stats || data.summary || data;

    const metricValues = [
      {
        label: "Sessions Logged",
        value: stats.sessions_count ?? stats.total_sessions ?? stats.sessions,
        suffix: ""
      },
      {
        label: "Overall Accuracy",
        value: stats.accuracy ?? stats.overall_accuracy,
        suffix: "%"
      },
      {
        label: "Total Bounties",
        value: stats.total_score ?? stats.total_points ?? stats.total_bounties,
        suffix: ""
      },
      {
        label: "Decryption Velocity",
        value: stats.velocity ?? stats.decryption_velocity,
        suffix: ""
      }
    ];

    const cards = $$("main section .grid > div");

    metricValues.forEach((metric) => {
      if (metric.value == null || typeof metric.value === "object") return;

      const card = cards.find((el) =>
        el.textContent.toLowerCase().includes(metric.label.toLowerCase())
      );

      if (!card) return;

      const valueElement = card.querySelector(".text-headline-sm");
      if (valueElement) {
        const value = typeof metric.value === "number"
          ? formatNumber(metric.value)
          : String(metric.value);

        setText(valueElement, value + metric.suffix);
      }
    });
  }

  function updateScoreChart(data) {
    const sessions =
      data.sessions ||
      data.recent_sessions ||
      data.score_history ||
      data.history;

    if (!Array.isArray(sessions) || sessions.length === 0) return;

    const svg = $$("main svg").find((el) =>
      el.querySelector("path[stroke*='url(#lineGrad)']") ||
      el.querySelector("#lineGrad")
    );

    if (!svg) return;

    const points = sessions
      .filter((s) => Number.isFinite(Number(s.score)))
      .slice(-10);

    if (points.length === 0) return;

    const scores = points.map((s) => Number(s.score));
    const maxScore = Math.max(...scores, 1);

    const xStart = 60;
    const xEnd = 600;
    const yTop = 20;
    const yBottom = 160;

    const coords = scores.map((score, i) => {
      const x = points.length === 1
        ? xEnd
        : xStart + (i / (points.length - 1)) * (xEnd - xStart);

      const y = yBottom - (score / maxScore) * (yBottom - yTop);
      return { x, y };
    });

    const pathData = coords
      .map((point, i) =>
        `${i === 0 ? "M" : "L"}${point.x.toFixed(1)},${point.y.toFixed(1)}`
      )
      .join(" ");

    const paths = [...svg.querySelectorAll("path")];
    const linePath = paths.find((p) =>
      p.getAttribute("filter")?.includes("cyanGlow")
    );

    if (linePath) linePath.setAttribute("d", pathData);

    const areaPath = paths.find((p) =>
      p.getAttribute("fill")?.includes("areaFill")
    );

    if (areaPath) {
      areaPath.setAttribute(
        "d",
        `${pathData} L${coords[coords.length - 1].x},${yBottom} L${coords[0].x},${yBottom} Z`
      );
    }

    const circles = [...svg.querySelectorAll("circle")];
    const chartCircles = circles.filter((circle) =>
      Number(circle.getAttribute("cy")) >= yTop &&
      Number(circle.getAttribute("cy")) <= yBottom
    );

    chartCircles.forEach((circle, i) => {
      if (coords[i]) {
        circle.setAttribute("cx", coords[i].x);
        circle.setAttribute("cy", coords[i].y);
      }
    });
  }

  function exportReport(data) {
    const report = JSON.stringify(data, null, 2);
    const blob = new Blob([report], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");

    link.href = url;
    link.download = "binary-heist-analytics.json";
    link.click();

    URL.revokeObjectURL(url);
  }

  async function loadAnalytics() {
    if (typeof Heist === "undefined" || typeof Heist.analytics !== "function") {
      showMessage("API client missing. Check that /js/heist-api.js loads first.");
      return;
    }

    const player = getPlayer();

    if (!player || !player.player_id) {
      showMessage("No logged-in operative found. Please log in first.");
      return;
    }

    try {
      showMessage("Loading operative analytics from server...");

      updateProfile(player);

      const data = await Heist.analytics();

      updateSummary(data);
      updateScoreChart(data);

      const message = $("#analytics-message");
      if (message) message.remove();

      window.currentAnalytics = data;
    } catch (error) {
      console.error("Analytics API error:", error);

      showMessage(
        "Could not load analytics. Check the server and /api/players/:id/analytics endpoint."
      );
    }
  }

  // Connect export button.
  const exportButton = $$("button").find((button) =>
    button.textContent.includes("EXPORT TELEMETRY REPORT")
  );

  if (exportButton) {
    exportButton.addEventListener("click", () => {
      if (window.currentAnalytics) {
        exportReport(window.currentAnalytics);
      } else {
        showMessage("Analytics have not loaded yet. Try again after loading.");
      }
    });
  }

  // Connect return-to-deck button.
  const deckButton = $$("button").find((button) =>
    button.textContent.includes("RETURN TO COMMAND DECK")
  );

  if (deckButton) {
    deckButton.addEventListener("click", () => {
      window.location.href = "/index.html";
    });
  }

  // Connect next mission button.
  const nextButton = $$("footer button").find((button) =>
    button.textContent.includes("CASE 0102")
  );

  if (nextButton) {
    nextButton.addEventListener("click", () => {
      window.location.href = "/index.html";
    });
  }

  loadAnalytics();
});
