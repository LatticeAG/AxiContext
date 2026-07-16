import type { SetupPlan } from "./types.js";

export function generateDevcontainer(plan: SetupPlan): string {
  const base = {
    name: plan.project_name,
    features: {},
    forwardPorts: plan.forward_ports,
    postCreateCommand: "bash scripts/bootstrap.sh",
    remoteUser: plan.remote_user,
    customizations: {
      vscode: {
        extensions: [],
      },
    },
  };

  if (plan.services.length > 0) {
    return `${JSON.stringify(
      {
        name: base.name,
        dockerComposeFile: "docker-compose.yml",
        service: "app",
        workspaceFolder: "/workspace",
        features: base.features,
        forwardPorts: base.forwardPorts,
        postCreateCommand: base.postCreateCommand,
        remoteUser: base.remoteUser,
        customizations: base.customizations,
      },
      null,
      2,
    )}\n`;
  }

  return `${JSON.stringify(
    {
      name: base.name,
      image: plan.runtime.image,
      features: base.features,
      forwardPorts: base.forwardPorts,
      postCreateCommand: base.postCreateCommand,
      remoteUser: base.remoteUser,
      customizations: base.customizations,
    },
    null,
    2,
  )}\n`;
}

export function generateComposeOverlay(plan: SetupPlan): string | null {
  if (plan.services.length === 0) {
    return null;
  }

  const lines = [
    `# axi-fence:generated digest=${plan.digest}`,
    "services:",
    "  app:",
    `    image: ${quoteYaml(plan.runtime.image)}`,
    "    command: sleep infinity",
    "    working_dir: /workspace",
    "    volumes:",
    "      - ..:/workspace:cached",
  ];

  for (const service of plan.services) {
    lines.push(`  ${service.name}:`);
    lines.push(`    image: ${quoteYaml(service.image)}`);
    lines.push("    ports:");
    lines.push(`      - "${service.port}:${service.port}"`);
    if (Object.keys(service.env).length > 0) {
      lines.push("    environment:");
      for (const key of Object.keys(service.env).sort((left, right) => left.localeCompare(right))) {
        lines.push(`      ${key}: ${quoteYaml(service.env[key] ?? "")}`);
      }
    }
  }

  return `${lines.join("\n")}\n`;
}

export function generateBootstrap(plan: SetupPlan): string {
  const lines = [
    "#!/usr/bin/env bash",
    "set -euo pipefail",
    `# axi-fence:generated digest=${plan.digest}`,
    "",
  ];

  if (plan.env_keys.length > 0) {
    lines.push('if [ ! -f ".env" ]; then');
    lines.push("  {");
    for (const key of plan.env_keys) {
      lines.push(`    printf '%s\\n' '${escapeSingleQuoted(`${key}=`)}'`);
    }
    lines.push("  } > .env");
    lines.push("fi");
    lines.push("");
  }

  for (const command of plan.install_commands) {
    lines.push(command);
  }

  if (plan.install_commands.length > 0 && plan.post_create_commands.length > 0) {
    lines.push("");
  }

  for (const command of plan.post_create_commands) {
    lines.push(command);
  }

  return `${lines.join("\n")}\n`;
}

export function generateReadmeSetup(plan: SetupPlan, version: string): string {
  const installCommands = plan.install_commands.length > 0 ? plan.install_commands : ["No install commands inferred."];
  const postCreateCommands =
    plan.post_create_commands.length > 0 ? plan.post_create_commands : ["No post-create commands inferred."];
  const ports = plan.forward_ports.length > 0 ? plan.forward_ports.map((port) => `- ${port}`) : ["- No forwarded ports inferred."];
  const envKeys = plan.env_keys.length > 0 ? plan.env_keys.map((key) => `- ${key}`) : ["- No env keys inferred."];

  return [
    `<!-- axi-fence:generated digest=${plan.digest} -->`,
    "",
    `# ${plan.project_name} setup`,
    "",
    "## Prerequisites",
    "",
    "- Docker Desktop or a compatible Docker engine",
    "- Visual Studio Code with the Dev Containers extension",
    "",
    "## Reopen in container",
    "",
    "Open this repository in VS Code, run `Dev Containers: Reopen in Container`, and review `scripts/bootstrap.sh` before first use.",
    "",
    "## What bootstrap runs",
    "",
    ...installCommands.map((command) => `- \`${command}\``),
    ...postCreateCommands.map((command) => `- \`${command}\``),
    "",
    "## Ports",
    "",
    ...ports,
    "",
    "## Env keys to fill",
    "",
    ...envKeys,
    "",
    "## Provenance",
    "",
    `- Plan digest: \`${plan.digest}\``,
    `- axi-fence version: \`${version}\``,
  ].join("\n");
}

function quoteYaml(value: string): string {
  return JSON.stringify(value);
}

function escapeSingleQuoted(value: string): string {
  return value.replaceAll("'", "'\\''");
}
