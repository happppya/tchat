// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, fireEvent } from "@testing-library/react";
import GameSettingsPanel from "./GameSettingsPanel";
import type { GameSettings } from "../types";

afterEach(() => cleanup());

const noop = () => {};

function renderPanel(props: Partial<React.ComponentProps<typeof GameSettingsPanel>> = {}) {
  return render(
    <GameSettingsPanel
      gameType={props.gameType ?? "impostor"}
      settings={props.settings ?? {}}
      onChange={props.onChange ?? noop}
    />
  );
}

describe("GameSettingsPanel — Impostor", () => {
  it("shows the impostor count field and reports changes", () => {
    const onChange = vi.fn();
    renderPanel({ gameType: "impostor", settings: { impostorCount: 1 }, onChange });

    const input = screen.getByTestId("set-impostorCount") as HTMLInputElement;
    expect(input.value).toBe("1");
    fireEvent.change(input, { target: { value: "2" } });
    expect(onChange).toHaveBeenCalledWith({ impostorCount: 2 });
  });

  it("keeps unedited settings in the payload", () => {
    const onChange = vi.fn();
    renderPanel({
      gameType: "impostor",
      settings: { impostorCount: 1, guessTimeMs: 40000 },
      onChange,
    });
    fireEvent.change(screen.getByTestId("set-guessTimeMs"), { target: { value: "15" } });
    expect(onChange).toHaveBeenCalledWith({ impostorCount: 1, guessTimeMs: 15000 });
  });
});

describe("GameSettingsPanel — Complete the Funny", () => {
  it("exposes prompts, rounds, and answer time", () => {
    renderPanel({ gameType: "complete-the-funny" });
    expect(screen.getByTestId("set-promptsPerPlayer")).toBeTruthy();
    expect(screen.getByTestId("set-rounds")).toBeTruthy();
    expect(screen.getByTestId("set-answerTimeLimitMs")).toBeTruthy();
  });

  it("reports a prompts change without clobbering rounds", () => {
    const onChange = vi.fn();
    renderPanel({
      gameType: "complete-the-funny",
      settings: { rounds: 5, promptsPerPlayer: 4 },
      onChange,
    });
    fireEvent.change(screen.getByTestId("set-promptsPerPlayer"), { target: { value: "7" } });
    expect(onChange).toHaveBeenCalledWith({ rounds: 5, promptsPerPlayer: 7 });
  });
});