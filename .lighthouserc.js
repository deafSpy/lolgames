// Lighthouse CI configuration
// Mobile performance budget enforced on every PR targeting main.
// Throttling: simulated 4G (150ms RTT, 1.6 Mbps down, 4× CPU slowdown).
// Budget: Performance ≥ 80 | LCP < 2.5s | CLS < 0.1 | TBT < 200ms (lab proxy for FID/INP)
module.exports = {
  ci: {
    collect: {
      url: [
        "http://localhost:3000/",
        "http://localhost:3000/lobby",
        "http://localhost:3000/game/demo-room",
      ],
      numberOfRuns: 3,
      settings: {
        formFactor: "mobile",
        throttlingMethod: "simulate",
        throttling: {
          rttMs: 150,
          throughputKbps: 1638.4,
          cpuSlowdownMultiplier: 4,
          requestLatencyMs: 562.5,
          downloadThroughputKbps: 1474.56,
          uploadThroughputKbps: 675,
        },
        screenEmulation: {
          mobile: true,
          width: 390,
          height: 844,
          deviceScaleFactor: 3,
          disabled: false,
        },
        emulatedUserAgent:
          "Mozilla/5.0 (Linux; Android 11; moto g power (2022)) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Mobile Safari/537.36",
      },
    },
    assert: {
      assertions: {
        // Performance score ≥ 80
        "categories:performance": ["error", { minScore: 0.8 }],
        // LCP < 2.5 s
        "largest-contentful-paint": ["error", { maxNumericValue: 2500 }],
        // CLS < 0.1
        "cumulative-layout-shift": ["error", { maxNumericValue: 0.1 }],
        // TBT < 200 ms (lab-measurable proxy for FID/INP)
        "total-blocking-time": ["error", { maxNumericValue: 200 }],
      },
    },
    upload: {
      target: "filesystem",
      outputDir: ".lighthouseci",
    },
  },
};
