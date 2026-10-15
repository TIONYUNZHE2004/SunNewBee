// @vitest-environment jsdom
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useScene } from "../scene/sceneStore";
import { ChatPanel } from "./ChatPanel";
import { useChatDraft } from "./chatDraftStore";

// The send path is the network edge: replace the hook, keep the real panel and stores.
const stream = vi.hoisted(() => ({
  send: undefined as unknown as ReturnType<typeof vi.fn>,
  streaming: false,
}));
vi.mock("./useChatStream", () => ({
  useChatStream: () => ({
    messages: [],
    send: stream.send,
    retry: vi.fn(),
    streaming: stream.streaming,
  }),
}));

beforeEach(() => {
  stream.send = vi.fn(async () => {});
  stream.streaming = false;
  useScene.getState().reset();
  useChatDraft.setState({ draft: "", pendingAsk: null, streaming: false });
});

describe("ChatPanel persona chips", () => {
  it("tapping a persona chip switches the profile and sends with it explicitly", async () => {
    const user = userEvent.setup();
    render(<ChatPanel />);
    expect(useScene.getState().profile).toBe("default");
    await user.click(
      screen.getByRole("button", { name: "Can I get to the lakeside mall in a wheelchair?" }),
    );
    expect(useScene.getState().profile).toBe("wheelchair");
    expect(stream.send).toHaveBeenCalledTimes(1);
    expect(stream.send).toHaveBeenCalledWith(
      "Can I get to the lakeside mall in a wheelchair?",
      "wheelchair",
    );
  });

  it("chips are disabled while an answer is streaming", () => {
    stream.streaming = true;
    render(<ChatPanel />);
    expect(
      screen.getByRole("button", { name: "Can I get to the lakeside mall with a stroller?" }),
    ).toBeDisabled();
  });

  it("typing a question and pressing Send sends it and clears the input", async () => {
    const user = userEvent.setup();
    render(<ChatPanel />);
    const send = screen.getByRole("button", { name: "Send" });
    expect(send).toBeDisabled();
    await user.type(screen.getByLabelText("Your question"), "Is Lake Park open?");
    await user.click(send);
    expect(stream.send).toHaveBeenCalledWith("Is Lake Park open?");
    expect(screen.getByLabelText("Your question")).toHaveValue("");
  });
});

describe("ChatPanel pendingAsk", () => {
  it("sends a pending ask once, with its persona and scenario, and clears it", async () => {
    useChatDraft.getState().ask("Which routes are cut off?", {
      profile: "stroller",
      scenarioId: "stage_p3m",
    });
    const { rerender } = render(<ChatPanel />);
    await waitFor(() => expect(stream.send).toHaveBeenCalledTimes(1));
    expect(stream.send).toHaveBeenCalledWith("Which routes are cut off?", "stroller", "stage_p3m");
    expect(useChatDraft.getState().pendingAsk).toBeNull();
    // Re-rendering (and the streaming mirror toggling) must not send it again.
    rerender(<ChatPanel />);
    act(() => useChatDraft.setState({ streaming: false }));
    rerender(<ChatPanel />);
    expect(stream.send).toHaveBeenCalledTimes(1);
  });

  it("waits while an answer is streaming, then sends when it ends", async () => {
    stream.streaming = true;
    useChatDraft.getState().ask("Where is the nearest centre?");
    const { rerender } = render(<ChatPanel />);
    expect(stream.send).not.toHaveBeenCalled();
    expect(useChatDraft.getState().pendingAsk).not.toBeNull();
    stream.streaming = false;
    rerender(<ChatPanel />);
    await waitFor(() => expect(stream.send).toHaveBeenCalledTimes(1));
    expect(stream.send).toHaveBeenCalledWith("Where is the nearest centre?", undefined, undefined);
    expect(useChatDraft.getState().pendingAsk).toBeNull();
  });
});
