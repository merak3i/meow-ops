// MeowOpsBar.swift — native macOS menu bar companion for meow-ops
// Shows today's cost from Claude Code + Codex Desktop, no login required.
// Reads ~/.claude/projects/**/*.jsonl and ~/.codex/sessions/**/*.jsonl directly.

import AppKit
import Foundation

// MARK: - Pricing ----------------------------------------------------------------

struct Pricing {
    let input: Double; let output: Double
    let cacheCreate: Double; let cacheRead: Double
}

let PRICING: [String: Pricing] = [
    "claude-opus-4-6":            .init(input:15,   output:75,  cacheCreate:18.75, cacheRead:1.5),
    "claude-sonnet-4-6":          .init(input:3,    output:15,  cacheCreate:3.75,  cacheRead:0.3),
    "claude-sonnet-4-5-20250514": .init(input:3,    output:15,  cacheCreate:3.75,  cacheRead:0.3),
    "claude-haiku-4-5-20251001":  .init(input:1,    output:5,   cacheCreate:1.25,  cacheRead:0.1),
    "gpt-5":                      .init(input:2.5,  output:10,  cacheCreate:0,     cacheRead:1.25),
    "gpt-4o":                     .init(input:2.5,  output:10,  cacheCreate:0,     cacheRead:1.25),
    "gpt-4o-mini":                .init(input:0.15, output:0.6, cacheCreate:0,     cacheRead:0.075),
    "o4-mini":                    .init(input:1.1,  output:4.4, cacheCreate:0,     cacheRead:0.275),
    "o3":                         .init(input:10,   output:40,  cacheCreate:0,     cacheRead:2.5),
]

let DEFAULT_PRICING = Pricing(input:3, output:15, cacheCreate:3.75, cacheRead:0.3)

func pickPricing(_ model: String) -> Pricing {
    if let p = PRICING[model] { return p }
    let m = model.lowercased()
    if m.contains("opus")         { return PRICING["claude-opus-4-6"]! }
    if m.contains("haiku")        { return PRICING["claude-haiku-4-5-20251001"]! }
    if m.contains("sonnet") || m.contains("claude") { return PRICING["claude-sonnet-4-6"]! }
    if m.contains("gpt-4o-mini")  { return PRICING["gpt-4o-mini"]! }
    if m.contains("gpt-4o") || m.contains("gpt-5") { return PRICING["gpt-4o"]! }
    if m.hasPrefix("o4")          { return PRICING["o4-mini"]! }
    if m.hasPrefix("o3")          { return PRICING["o3"]! }
    return DEFAULT_PRICING
}

func calculateCost(model: String, input: Int, output: Int, cacheCreate: Int = 0, cacheRead: Int = 0) -> Double {
    let p = pickPricing(model); let M = 1_000_000.0
    return (Double(input) * p.input / M) + (Double(output) * p.output / M) +
           (Double(cacheCreate) * p.cacheCreate / M) + (Double(cacheRead) * p.cacheRead / M)
}

// MARK: - Data structures --------------------------------------------------------

struct ToolStats {
    var todayCost: Double = 0; var todaySessions: Int = 0
    var weekCost:  Double = 0; var monthCost:     Double = 0
}

struct UsageSummary {
    var claude = ToolStats(); var codex = ToolStats()
    var totalToday:    Double { claude.todayCost   + codex.todayCost   }
    var totalWeek:     Double { claude.weekCost    + codex.weekCost    }
    var totalMonth:    Double { claude.monthCost   + codex.monthCost   }
    var totalSessions: Int    { claude.todaySessions + codex.todaySessions }
}

// MARK: - ISO8601 helper ---------------------------------------------------------

func parseISO(_ s: String) -> Date? {
    let frac = ISO8601DateFormatter(); frac.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
    if let d = frac.date(from: s) { return d }
    return ISO8601DateFormatter().date(from: s)
}

// MARK: - Claude Code parser -----------------------------------------------------

func parseClaudeSessions(home: URL, todayStart: Date, weekStart: Date, monthStart: Date) -> ToolStats {
    var stats = ToolStats()
    let dir = home.appendingPathComponent(".claude/projects")
    guard let enumerator = FileManager.default.enumerator(at: dir, includingPropertiesForKeys: nil) else { return stats }

    var todayIDs = Set<String>()

    for case let url as URL in enumerator {
        guard url.pathExtension == "jsonl",
              !url.path.contains("/.claude-worktrees/") else { continue }
        guard let content = try? String(contentsOf: url, encoding: .utf8) else { continue }

        var fileTs: Date?; var sessionID: String?; var fileCost = 0.0

        for line in content.split(separator: "\n", omittingEmptySubsequences: true) {
            guard let data = String(line).data(using: .utf8),
                  let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else { continue }

            if fileTs == nil, let ts = json["timestamp"] as? String { fileTs = parseISO(ts) }
            if sessionID == nil, let sid = json["sessionId"] as? String { sessionID = sid }

            guard (json["type"] as? String) == "assistant",
                  let msg   = json["message"] as? [String: Any],
                  let usage = msg["usage"]    as? [String: Any],
                  let model = msg["model"]    as? String else { continue }

            fileCost += calculateCost(
                model: model,
                input:       usage["input_tokens"]                  as? Int ?? 0,
                output:      usage["output_tokens"]                 as? Int ?? 0,
                cacheCreate: usage["cache_creation_input_tokens"]   as? Int ?? 0,
                cacheRead:   usage["cache_read_input_tokens"]       as? Int ?? 0
            )
        }

        guard let ts = fileTs else { continue }
        if ts >= monthStart { stats.monthCost += fileCost }
        if ts >= weekStart  { stats.weekCost  += fileCost }
        if ts >= todayStart { stats.todayCost += fileCost; if let sid = sessionID { todayIDs.insert(sid) } }
    }

    stats.todaySessions = todayIDs.count
    return stats
}

// MARK: - Codex Desktop parser ---------------------------------------------------

func inferCodexModel(_ text: String) -> String {
    if text.range(of: "GPT-5",      options: .caseInsensitive) != nil { return "gpt-5"      }
    if text.range(of: "GPT-4o mini",options: .caseInsensitive) != nil { return "gpt-4o-mini"}
    if text.range(of: "GPT-4o",     options: .caseInsensitive) != nil { return "gpt-4o"     }
    if text.range(of: "o4-mini",    options: .caseInsensitive) != nil { return "o4-mini"    }
    if text.range(of: " o3",        options: .caseInsensitive) != nil { return "o3"         }
    return "gpt-4o"
}

func parseCodexSessions(home: URL, todayStart: Date, weekStart: Date, monthStart: Date) -> ToolStats {
    var stats = ToolStats()
    let sessionsDir = home.appendingPathComponent(".codex/sessions")
    guard FileManager.default.fileExists(atPath: sessionsDir.path) else { return stats }

    let fm = FileManager.default
    guard let years = try? fm.contentsOfDirectory(atPath: sessionsDir.path) else { return stats }

    for year in years {
        guard year.count == 4, Int(year) != nil else { continue }
        let yPath = sessionsDir.appendingPathComponent(year)
        guard let months = try? fm.contentsOfDirectory(atPath: yPath.path) else { continue }
        for month in months {
            let mPath = yPath.appendingPathComponent(month)
            guard let days = try? fm.contentsOfDirectory(atPath: mPath.path) else { continue }
            for day in days {
                let dPath = mPath.appendingPathComponent(day)
                guard let files = try? fm.contentsOfDirectory(atPath: dPath.path) else { continue }
                for file in files {
                    guard file.hasSuffix(".jsonl"), file.hasPrefix("rollout-") else { continue }
                    let fURL = dPath.appendingPathComponent(file)
                    guard let content = try? String(contentsOf: fURL, encoding: .utf8) else { continue }

                    var fileTs: Date?; var model = "gpt-4o"; var lastUsage: [String: Any]?

                    for line in content.split(separator: "\n", omittingEmptySubsequences: true) {
                        guard let data = String(line).data(using: .utf8),
                              let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else { continue }

                        if fileTs == nil, let ts = json["timestamp"] as? String { fileTs = parseISO(ts) }

                        if (json["type"] as? String) == "session_meta",
                           let payload = json["payload"] as? [String: Any],
                           let bi = payload["base_instructions"] as? [String: Any],
                           let text = bi["text"] as? String {
                            model = inferCodexModel(text)
                        }

                        if (json["type"] as? String) == "event_msg",
                           let payload = json["payload"] as? [String: Any],
                           (payload["type"] as? String) == "token_count",
                           let info = payload["info"] as? [String: Any],
                           let usage = info["total_token_usage"] as? [String: Any] {
                            lastUsage = usage
                        }
                    }

                    guard let ts = fileTs, let usage = lastUsage else { continue }
                    let cost = calculateCost(
                        model: model,
                        input:     usage["input_tokens"]        as? Int ?? 0,
                        output:    usage["output_tokens"]       as? Int ?? 0,
                        cacheRead: usage["cached_input_tokens"] as? Int ?? 0
                    )
                    if ts >= monthStart { stats.monthCost += cost }
                    if ts >= weekStart  { stats.weekCost  += cost }
                    if ts >= todayStart { stats.todayCost += cost; stats.todaySessions += 1 }
                }
            }
        }
    }
    return stats
}

// MARK: - App Delegate -----------------------------------------------------------

class AppDelegate: NSObject, NSApplicationDelegate {
    var statusItem: NSStatusItem!
    var timer: Timer?
    var summary = UsageSummary()

    func applicationDidFinishLaunching(_ n: Notification) {
        NSApp.setActivationPolicy(.accessory)
        statusItem = NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength)
        if let btn = statusItem.button { btn.title = "🐾 …"; btn.action = #selector(showMenu); btn.target = self }
        refresh()
        timer = Timer.scheduledTimer(withTimeInterval: 300, repeats: true) { [weak self] _ in self?.refresh() }
    }

    func refresh() {
        DispatchQueue.global(qos: .utility).async { [weak self] in
            guard let self else { return }
            let s = self.computeSummary()
            DispatchQueue.main.async { self.summary = s; self.updateTitle() }
        }
    }

    func computeSummary() -> UsageSummary {
        let home = FileManager.default.homeDirectoryForCurrentUser
        let cal = Calendar.current; let now = Date()
        let today = cal.startOfDay(for: now)
        let week  = cal.date(byAdding: .day, value: -7,  to: today)!
        let month = cal.date(byAdding: .day, value: -30, to: today)!
        var s = UsageSummary()
        s.claude = parseClaudeSessions(home: home, todayStart: today, weekStart: week, monthStart: month)
        s.codex  = parseCodexSessions(home:  home, todayStart: today, weekStart: week, monthStart: month)
        return s
    }

    func updateTitle() {
        let c = summary.totalToday
        statusItem.button?.title = c >= 0.005 ? String(format: "🐾 $%.2f", c) : "🐾 –"
    }

    @objc func showMenu() {
        let m = NSMenu()

        func info(_ t: String) -> NSMenuItem {
            let i = NSMenuItem(title: t, action: nil, keyEquivalent: ""); i.isEnabled = false; return i
        }

        m.addItem(info(String(format: "Today   $%.2f · %d sessions", summary.totalToday, summary.totalSessions)))
        m.addItem(info(String(format: "Week    $%.2f", summary.totalWeek)))
        m.addItem(info(String(format: "30 days $%.2f", summary.totalMonth)))
        m.addItem(.separator())
        m.addItem(info(String(format: "Claude Code  $%.2f  (%d)", summary.claude.todayCost, summary.claude.todaySessions)))
        if summary.codex.todaySessions > 0 || summary.codex.todayCost > 0.001 {
            m.addItem(info(String(format: "Codex        $%.2f  (%d)", summary.codex.todayCost, summary.codex.todaySessions)))
        }
        m.addItem(.separator())

        let open = NSMenuItem(title: "Open meow-ops dashboard →", action: #selector(openDashboard), keyEquivalent: ""); open.target = self; m.addItem(open)
        let sync = NSMenuItem(title: "Sync Now",                  action: #selector(syncNow),       keyEquivalent: "r"); sync.target = self; m.addItem(sync)
        m.addItem(.separator())
        m.addItem(NSMenuItem(title: "Quit", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q"))

        statusItem.menu = m
        statusItem.button?.performClick(nil)
        statusItem.menu = nil
    }

    @objc func openDashboard() {
        // Try dev server first, fall back to production
        let dev  = URL(string: "http://localhost:5173")!
        let prod = URL(string: "https://meow-ops.vercel.app")!
        var req = URLRequest(url: dev); req.timeoutInterval = 0.8
        URLSession.shared.dataTask(with: req) { _, resp, _ in
            let open = (resp as? HTTPURLResponse).map { $0.statusCode < 500 } ?? false
            DispatchQueue.main.async { NSWorkspace.shared.open(open ? dev : prod) }
        }.resume()
    }

    @objc func syncNow() {
        statusItem.button?.title = "🐾 ↻"
        let home = FileManager.default.homeDirectoryForCurrentUser.path
        let repoPath = (home as NSString).appendingPathComponent("repos/meow-ops")
        let node = ["/opt/homebrew/bin/node", "/usr/local/bin/node", "/usr/bin/node"]
            .first { FileManager.default.fileExists(atPath: $0) } ?? "/usr/bin/env node"
        let task = Process()
        task.executableURL = URL(fileURLWithPath: node.hasPrefix("/usr/bin/env") ? "/usr/bin/env" : node)
        task.arguments     = node.hasPrefix("/usr/bin/env") ? ["node", "sync/export-local.mjs"] : ["sync/export-local.mjs"]
        task.currentDirectoryURL = URL(fileURLWithPath: repoPath)
        task.terminationHandler = { [weak self] _ in DispatchQueue.main.async { self?.refresh() } }
        try? task.run()
    }
}

// MARK: - Entry point ------------------------------------------------------------

let app = NSApplication.shared
let delegate = AppDelegate()
app.delegate = delegate
app.run()
