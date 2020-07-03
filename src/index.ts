import { ChildProcess, spawn } from "child_process";
import { join } from "path";
import Serverless from "serverless";
import { ServerlessPluginCommand } from "../types/serverless-plugin-command";
import { ElasticMQLaunchOptions, ElasticMQConfig } from "../types/elasticMQ";

const MQ_LOCAL_PATH = join(__dirname, "../bin");

const pause = async (duration: number) =>
  new Promise((r) => setTimeout(r, duration));

class ServerlessOfflineElasticMqPlugin {
  public readonly commands: Record<string, ServerlessPluginCommand>;
  public readonly hooks: Record<string, () => Promise<any>>;
  private elasticMqConfig: ElasticMQConfig;
  private mqInstances: Record<string, ChildProcess> = {};

  public constructor(private serverless: Serverless) {
    this.commands = {};

    this.elasticMqConfig = this.serverless.service?.custom?.elasticmq || {};

    this.hooks = {
      "before:offline:start:end": this.stopElasticMq,
      "before:offline:start": this.startElasticMq,
    };
  }

  private spawnElasticMqProcess = async (options: ElasticMQLaunchOptions) => {
    // We are trying to construct something like this:
    // java -jar bin/elasticmq-server-0.15.7.jar

    const port = (options.port || 9324).toString();

    const args = [];

    args.push("-jar", "elasticmq-server-0.15.7.jar");

    const proc = spawn("java", args, {
      cwd: MQ_LOCAL_PATH,
      env: process.env,
      stdio: ["pipe", "pipe", process.stderr],
    });

    if (proc.pid == null) {
      throw new Error("Unable to start the ElasticMq Local process");
    }

    proc.on("error", (error) => {
      throw error;
    });

    this.mqInstances[port] = proc;

    (([
      "beforeExit",
      "exit",
      "SIGINT",
      "SIGTERM",
      "SIGUSR1",
      "SIGUSR2",
      "uncaughtException",
    ] as unknown) as NodeJS.Signals[]).forEach((eventType) => {
      process.on(eventType, () => {
        this.killElasticMqProcess(this.elasticMqConfig.start);
      });
    });

    return { proc, port };
  };

  private killElasticMqProcess = (options: ElasticMQLaunchOptions) => {
    const port = (options.port || 9324).toString();

    if (this.mqInstances[port] != null) {
      this.mqInstances[port].kill("SIGKILL");
      delete this.mqInstances[port];
    }
  };

  private shouldExecute = () => {
    if (
      this.elasticMqConfig.stages &&
      this.elasticMqConfig.stages.includes(
        this.serverless.service.provider.stage,
      )
    ) {
      return true;
    }
    return false;
  };

  private startElasticMq = async () => {
    if (this.elasticMqConfig.start.noStart || !this.shouldExecute()) {
      this.serverless.cli.log(
        "ElasticMq Offline - [noStart] options is true. Will not start.",
      );
      return;
    }

    const { port, proc } = await this.spawnElasticMqProcess(
      this.elasticMqConfig.start,
    );

    proc.on("close", (code) => {
      this.serverless.cli.log(
        `ElasticMq Offline - Failed to start with code ${code}`,
      );
    });

    this.serverless.cli.log(
      `ElasticMq Offline - Started, visit: http://localhost:${port}`,
    );

    await Promise.resolve(pause(2000));
  };

  private stopElasticMq = async () => {
    this.killElasticMqProcess(this.elasticMqConfig.start);
    this.serverless.cli.log("ElasticMq Process - Stopped");
  };
}

export = ServerlessOfflineElasticMqPlugin;
