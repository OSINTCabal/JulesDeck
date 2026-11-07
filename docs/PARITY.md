# JulesDeck workspaces

JulesDeck has local repository tools, a GitHub repository workflow, and an optional embedded Cloud Jules page. The local workspaces use configured coding engines rather than depending on one cloud runner.

## Feature comparison

| Feature | Local workspace | GitHub / Repo | Cloud Jules |
| --- | --- | --- | --- |
| Repository access | Folder selected on this machine | Managed clone through Git and GitHub CLI | Repositories connected to the upstream account |
| Coding | Selected local CLI engine | Selected local CLI engine on a task branch | Upstream cloud runner |
| Plans | Plan review before execution | Plan review before execution | Upstream page workflow |
| Changes | Git status, diffs, branches, commits | Task branches, diffs, commit and publish controls | Upstream branch and pull request controls |
| Authentication | Selected engine's own credentials | Engine credentials plus GitHub CLI authorization | Separate Google web session |
| Service dependency | The selected coding provider | Coding provider and GitHub for remote actions | Google's cloud service |

## Data and credentials

Repository files, plans, and session records are stored locally. Running a model-backed task can send prompts and project context to the selected provider. Local storage does not imply offline inference.

Each cloud account uses a separate Electron session partition. Switching web accounts does not change the selected local repository or authenticate another coding CLI. Sign-out clears the selected web partition; local repositories and CLI credentials remain separate.

## Verification

Automated tests use temporary Git repositories, mock engines, and simulated accounts. They cover planning, streamed output, cancellation, diffs, GitHub publishing fixtures, navigation, and account isolation. These tests do not certify fresh Google consent or a paid coding request.

[Verification](VERIFICATION.md) · [Back to JulesDeck](../README.md)
