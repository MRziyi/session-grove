# Session Grove

**English** · [简体中文](README.zh-CN.md)

**Keep the context. Explore a branch. Come back to the work.**

Session Grove is a local session manager for **Claude Code and Codex** on Windows and macOS. Bring scattered AI conversations into projects, see how ideas branched, and continue from the context you actually want.

For research, writing and software projects that outgrow a flat chat list.

![A project with named branches, original conversation and a selected active path](docs/images/workspace.png)

*The transcript and the branch graph stay together. Select a node to see the conversation behind it.*

## When the work has more than one direction

You establish a useful context, try two approaches, refine one, and return to an earlier idea. Later, several conversations have similar names. The important part is remembering how they fit together.

| What you want to do | How Grove helps |
| --- | --- |
| Keep a project together | Group Claude and Codex sessions in one project. Related conversations appear as a tree with shared history. |
| Find a useful idea again | Search your library, read the original transcript and give stretches of work meaningful names. |
| Try another direction | Activate a selected node to create a continuation from that context while preserving existing branches. |
| Choose how much history to carry | Preview context and token estimates; use recorded compaction or the available history before it. |
| Continue in another tool | **Activate as** converts a selected prefix for Claude Code or Codex, with three choices for how much text to include. |
| Pick up on another computer | Pull your library from a private Git repository, then activate the session in a local working folder. |

Keep talking in your preferred agent. Use Grove to organize, compare and return to the work.

## A library that follows your projects

Named projects hold ongoing work. **Ungrouped** keeps everyday questions close until they belong somewhere. Agent and device badges show where a conversation came from, and Active marks what is available in your client on this computer.

![Project library with a shared conversation tree, Claude and Codex sessions, and an Ungrouped inbox](docs/images/library.png)

New conversation stays in **Pending**. Select a range to give it a name such as “Project brief”, “Compare approaches” or “Prototype feedback”. Those names organize your history without rewriting the conversation. Double-click a project, session or node title to edit it in place; the check mark saves, while clicking elsewhere or pressing Escape cancels.

## Continue from a useful point

Select a node and choose **Activate**. Grove shows the context estimate, destination folder and the title you will see in your agent. Use **Switch tool** in the same panel to continue with another agent.

![Activation preview for an earlier branch point, with context estimate and tool switching](docs/images/activation.png)

Same-agent activation preserves supported native records, including recorded tool activity and reasoning. Cross-agent conversion carries a text representation with source provenance. Client instructions, model behavior, external files and opaque compaction can differ; see the [context guide](docs/context-and-sync.md) for the boundaries.

## Less housekeeping

Optional **Smart Organization** names existing and new sessions, classifies new inbox entries and labels branch points. Enable session organization and node naming independently with your own OpenAI API key. Manually chosen names stay yours.

Requests default to two at a time. Settings lets you choose serial operation or up to four concurrent requests, and set a minimum request interval. Progress shows what is running, what remains and anything that needs attention. Selected messages are sent to OpenAI only when enabled.

Settings also provides Codex context-window and compaction controls, plus Claude’s auto-compaction window. Empty values inherit client defaults; model capacity still applies. Removing a saved API key restores the key-entry workflow.

## Try it in a few minutes

Install **Node.js 24+** and Git, then:

```sh
git clone https://github.com/MRziyi/session-grove.git
cd session-grove
pnpm install
pnpm run demo
```

Open **http://127.0.0.1:7421**. Demo mode uses sample sessions and does not read personal history. The screenshots above use synthetic examples in the real interface.

To use your own history, stop the demo, run `pnpm start`, then click **Update**. Grove reads the local Claude Code and Codex session folders. You can keep the agents running while browsing, organizing or creating a new continuation.

Prefer npm? Use `npm install`, `npm run demo` and `npm start`. Switch between English and Chinese at the bottom of the sidebar.

## Start automatically at login

Login startup is **off by default**. After opening Grove, go to **Settings → Local service → Start automatically at login**:

1. Turn the switch on to start Grove automatically when you next sign in to macOS or Windows.
2. Check the status beside it: **Disabled**, **Enabled**, **Updating**, or **Failed**. Failed changes keep the previous setting and show the reason.
3. Turn it off to disable future login startup. The currently running service stays available.

Grove sets up the current user's macOS LaunchAgent or Windows Startup shortcut for you; no terminal configuration is required. Demo mode disables this control. If you move the repository or change your Node installation, turn the switch off and on again to refresh its saved paths. Background output is in `~/.session-grove/logs/server.log` (Windows: `%USERPROFILE%\.session-grove\logs\server.log`).

## Your history, across your computers

For optional sync, connect a **private Git SSH repository** in Settings. **Pull** downloads the library; **Push** pulls first, then publishes local changes. Both are manual by default. Automatic upload is opt-in, and each device keeps its own Active choices.

Sessions remain local and the sync repository contains readable history. Your projects’ code, agent credentials and Smart Organization key are not included. Trash removes a session from the current library; local recovery is available for a configurable period, and older Git commits retain their history.

## Learn more

[Setup and troubleshooting](docs/operations.md) · [Context and branches](docs/context-and-sync.md) · [Git sync](docs/git-sync.md) · [1.0 validation and performance](docs/1.0-windows-validation.md) · [1.1 real-workspace validation](docs/1.1-validation.md) · [Changelog](CHANGELOG.md)

For a bug report, include what you selected, what happened and the error reference shown in the interface. Please keep private conversation text and credentials out of public issues.

Contributions and [issues](https://github.com/MRziyi/session-grove/issues) are welcome. Run `pnpm test` for the regression suite and `pnpm test:browser` for browser acceptance.

Created by [Ziyi Zhang](https://ziyi-zhang.vercel.app). Inspired by [codex-session-sync](https://github.com/shonngithub/codex-session-sync), [claude-sync](https://github.com/tawanorg/claude-sync) and [Chronicle](https://github.com/geekmuse/chronicle). [MIT License](LICENSE).
