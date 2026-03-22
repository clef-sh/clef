import { Daemon } from "./daemon";
import { ArtifactPoller } from "@clef-sh/runtime";
import { AgentServerHandle } from "../server";

describe("Daemon", () => {
  let mockPoller: jest.Mocked<
    Pick<ArtifactPoller, "start" | "startPolling" | "stop" | "isRunning">
  >;
  let mockServer: jest.Mocked<AgentServerHandle>;
  let signalHandlers: Record<string, (() => void)[]>;

  beforeEach(() => {
    jest.clearAllMocks();
    signalHandlers = {};

    mockPoller = {
      start: jest.fn().mockResolvedValue(undefined),
      startPolling: jest.fn(),
      stop: jest.fn(),
      isRunning: jest.fn().mockReturnValue(true),
    };

    mockServer = {
      url: "http://127.0.0.1:7779",
      stop: jest.fn().mockResolvedValue(undefined),
      address: jest.fn().mockReturnValue({ address: "127.0.0.1", family: "IPv4", port: 7779 }),
    };

    // Capture signal handlers without actually registering them on the real process
    jest.spyOn(process, "on").mockImplementation(function (
      this: NodeJS.Process,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- matching overloaded process.on signature
      event: any,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- matching overloaded process.on signature
      listener: any,
    ) {
      if (!signalHandlers[event]) signalHandlers[event] = [];
      signalHandlers[event].push(listener);
      return this;
    } as NodeJS.Process["on"]);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("should start poller and register signal handlers", async () => {
    const onLog = jest.fn();
    const daemon = new Daemon({
      poller: mockPoller as unknown as ArtifactPoller,
      server: mockServer,
      onLog,
    });

    await daemon.start();

    expect(mockPoller.startPolling).toHaveBeenCalled();
    expect(signalHandlers["SIGTERM"]).toBeDefined();
    expect(signalHandlers["SIGINT"]).toBeDefined();
    expect(onLog).toHaveBeenCalledWith(expect.stringContaining("127.0.0.1:7779"));
    expect(onLog).toHaveBeenCalledWith(expect.stringContaining("ready"));
  });

  it("should gracefully shutdown on SIGTERM", async () => {
    const onLog = jest.fn();
    const daemon = new Daemon({
      poller: mockPoller as unknown as ArtifactPoller,
      server: mockServer,
      onLog,
    });

    await daemon.start();

    // Simulate SIGTERM
    for (const handler of signalHandlers["SIGTERM"] || []) {
      await handler();
    }

    expect(mockPoller.stop).toHaveBeenCalled();
    expect(mockServer.stop).toHaveBeenCalled();
    expect(onLog).toHaveBeenCalledWith("Shutting down...");
    expect(onLog).toHaveBeenCalledWith("Shutdown complete.");
  });

  it("should gracefully shutdown on SIGINT", async () => {
    const daemon = new Daemon({
      poller: mockPoller as unknown as ArtifactPoller,
      server: mockServer,
    });

    await daemon.start();

    for (const handler of signalHandlers["SIGINT"] || []) {
      await handler();
    }

    expect(mockPoller.stop).toHaveBeenCalled();
    expect(mockServer.stop).toHaveBeenCalled();
  });

  it("should only shutdown once on repeated signals", async () => {
    const daemon = new Daemon({
      poller: mockPoller as unknown as ArtifactPoller,
      server: mockServer,
    });

    await daemon.start();

    // Simulate multiple signals
    for (const handler of signalHandlers["SIGTERM"] || []) {
      await handler();
    }
    for (const handler of signalHandlers["SIGTERM"] || []) {
      await handler();
    }

    // stop should only be called once
    expect(mockServer.stop).toHaveBeenCalledTimes(1);
  });
});
