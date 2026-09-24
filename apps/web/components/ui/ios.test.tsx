// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import {
  ActionSheet,
  ActivityRings,
  CompareTable,
  GroupedList,
  HungerSlider,
  IOSAlert,
  ListRow,
  NotifStack,
  ScrollStory,
  SegmentedTabs,
  Sheet,
  Toggle,
  WalletPass,
  WardMap,
} from "./ios";

afterEach(() => {
  cleanup();
  document.body.style.overflow = "";
});

describe("SegmentedTabs", () => {
  const items = [
    { id: "dogs", label: "Dogs" },
    { id: "feeds", label: "Feeds" },
    { id: "badges", label: "Badges" },
  ];

  it("moves selection and focus with arrow keys, wrapping, Home/End", () => {
    const onChange = vi.fn();
    render(<SegmentedTabs items={items} aria-label="Your activity" onChange={onChange} />);
    const tabs = screen.getAllByRole("tab");
    expect(screen.getByRole("tablist", { name: "Your activity" })).toBeTruthy();
    expect(tabs[0]!.getAttribute("aria-selected")).toBe("true");
    expect(tabs[0]!.tabIndex).toBe(0);
    expect(tabs[1]!.tabIndex).toBe(-1);

    tabs[0]!.focus();
    fireEvent.keyDown(tabs[0]!, { key: "ArrowRight" });
    expect(tabs[1]!.getAttribute("aria-selected")).toBe("true");
    expect(tabs[0]!.getAttribute("aria-selected")).toBe("false");
    expect(document.activeElement).toBe(tabs[1]);
    expect(onChange).toHaveBeenLastCalledWith("feeds");

    fireEvent.keyDown(tabs[1]!, { key: "ArrowLeft" });
    fireEvent.keyDown(tabs[0]!, { key: "ArrowLeft" });
    expect(tabs[2]!.getAttribute("aria-selected")).toBe("true");

    fireEvent.keyDown(tabs[2]!, { key: "Home" });
    expect(tabs[0]!.getAttribute("aria-selected")).toBe("true");
    fireEvent.keyDown(tabs[0]!, { key: "End" });
    expect(tabs[2]!.getAttribute("aria-selected")).toBe("true");
  });

  it("is controllable and wires panels with aria-controls", () => {
    function Harness(): React.JSX.Element {
      const [v, setV] = useState("feeds");
      return (
        <SegmentedTabs
          items={items}
          value={v}
          onChange={setV}
          aria-label="Activity"
          panels={{ dogs: <p>Dog list</p>, feeds: <p>Feed list</p>, badges: <p>Badge list</p> }}
        />
      );
    }
    render(<Harness />);
    const feeds = screen.getByRole("tab", { name: "Feeds" });
    expect(feeds.getAttribute("aria-selected")).toBe("true");
    const panel = screen.getByRole("tabpanel");
    expect(panel.textContent).toBe("Feed list");
    expect(feeds.getAttribute("aria-controls")).toBe(panel.id);
    fireEvent.click(screen.getByRole("tab", { name: "Badges" }));
    expect(screen.getByRole("tabpanel").textContent).toBe("Badge list");
  });
});

describe("Toggle", () => {
  it("is a real checkbox with role=switch that toggles", () => {
    const onChange = vi.fn();
    render(<Toggle label="SOS alerts near me" description="Ward-level only" onChange={onChange} />);
    const sw = screen.getByRole("switch", { name: "SOS alerts near me" }) as HTMLInputElement;
    expect(sw.type).toBe("checkbox");
    expect(sw.checked).toBe(false);
    fireEvent.click(sw);
    expect(sw.checked).toBe(true);
    expect(onChange).toHaveBeenCalledTimes(1);
    // Clicking the label text toggles too (whole row is the target).
    fireEvent.click(screen.getByText("SOS alerts near me"));
    expect(sw.checked).toBe(false);
    expect(sw.getAttribute("aria-describedby")).toBeTruthy();
  });
});

describe("Sheet", () => {
  function Harness({ onClose }: { onClose?: () => void }): React.JSX.Element {
    const [open, setOpen] = useState(false);
    return (
      <>
        <button type="button" onClick={() => setOpen(true)}>
          Log a feed
        </button>
        <Sheet
          open={open}
          onClose={() => {
            onClose?.();
            setOpen(false);
          }}
          title="Log a feed for Bruno"
        >
          <input aria-label="Note" />
          <button type="button">Save</button>
        </Sheet>
      </>
    );
  }

  it("opens as a modal dialog, traps focus, and closes on Escape", () => {
    const onClose = vi.fn();
    render(<Harness onClose={onClose} />);
    const opener = screen.getByRole("button", { name: "Log a feed" });
    opener.focus();
    fireEvent.click(opener);

    const dialog = screen.getByRole("dialog", { name: "Log a feed for Bruno" });
    expect(dialog.getAttribute("aria-modal")).toBe("true");
    expect(document.body.style.overflow).toBe("hidden");

    // First focusable is the close button in the header.
    const close = screen.getByRole("button", { name: "Close" });
    const save = screen.getByRole("button", { name: "Save" });
    expect(document.activeElement).toBe(close);

    // Shift+Tab from the first wraps to the last; Tab from the last wraps back.
    fireEvent.keyDown(document.activeElement!, { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(save);
    fireEvent.keyDown(document.activeElement!, { key: "Tab" });
    expect(document.activeElement).toBe(close);

    fireEvent.keyDown(document.activeElement!, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("renders nothing when closed", () => {
    render(<Sheet open={false} onClose={() => {}} title="Hidden" />);
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});

describe("IOSAlert", () => {
  it("static mode is a labelled image with no buttons", () => {
    render(
      <IOSAlert
        static
        title="Send SOS for Bruno?"
        message="Nearby vets in Dadar West will be alerted."
        actions={[{ label: "Cancel", style: "cancel" }, { label: "Send SOS", style: "destructive", preferred: true }]}
      />,
    );
    const img = screen.getByRole("img");
    expect(img.getAttribute("aria-label")).toBe(
      "Alert: Send SOS for Bruno?. Nearby vets in Dadar West will be alerted. Buttons: Cancel, Send SOS.",
    );
    expect(screen.queryAllByRole("button")).toHaveLength(0);
  });

  it("interactive mode is an alertdialog whose buttons call handlers", () => {
    const cancel = vi.fn();
    const send = vi.fn();
    render(
      <IOSAlert
        title="Collar doesn't match"
        message="This QR belongs to Biscuit, not Bruno."
        actions={[
          { label: "Cancel", style: "cancel", onPress: cancel },
          { label: "It's Biscuit", preferred: true, onPress: send },
        ]}
      />,
    );
    const dialog = screen.getByRole("alertdialog", { name: "Collar doesn't match" });
    expect(dialog.getAttribute("aria-describedby")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "It's Biscuit" }));
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(send).toHaveBeenCalledTimes(1);
    expect(cancel).toHaveBeenCalledTimes(1);
  });

  it("modal mode maps Escape to the cancel action", () => {
    const cancel = vi.fn();
    render(
      <IOSAlert
        modal
        title="Discard feed?"
        actions={[
          { label: "Keep", style: "cancel", onPress: cancel },
          { label: "Discard", style: "destructive" },
        ]}
      />,
    );
    const dialog = screen.getByRole("alertdialog");
    expect(dialog.getAttribute("aria-modal")).toBe("true");
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Keep" }));
    fireEvent.keyDown(document.activeElement!, { key: "Escape" });
    expect(cancel).toHaveBeenCalledTimes(1);
  });

  it("ActionSheet renders options and a separate cancel", () => {
    const onCancel = vi.fn();
    const report = vi.fn();
    render(
      <ActionSheet
        title="Bruno"
        options={[{ label: "Log a feed" }, { label: "Report SOS", destructive: true, onPress: report }]}
        onCancel={onCancel}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Report SOS" }));
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(report).toHaveBeenCalled();
    expect(onCancel).toHaveBeenCalled();
  });
});

describe("ActivityRings", () => {
  it("summarises every ring in its accessible name", () => {
    render(
      <ActivityRings
        rings={[
          { label: "Feeds", value: 3, goal: 4, color: ["#fa114f", "#ff5e8a"] },
          { label: "Coverage", value: 60, goal: 100, color: "#34c759", unit: "percent" },
          { label: "Streak", value: 36, goal: 30, color: "#00c7be", unit: "days" },
        ]}
      />,
    );
    expect(screen.getByRole("img").getAttribute("aria-label")).toBe(
      "Feeds 3 of 4, Coverage 60 of 100 percent, Streak 36 of 30 days",
    );
  });
});

describe("ScrollStory", () => {
  it("renders every step's title and text as real DOM text in jsdom", () => {
    render(
      <ScrollStory
        steps={[
          { id: "scan", title: "Scan", text: "Point your camera at the collar.", visual: <div>scan screen</div> },
          { id: "see", title: "See", text: "Fed 2h ago. Rabies due Fri.", visual: <div>see screen</div> },
          { id: "act", title: "Act", text: "Log a feed or raise an SOS.", visual: <div>act screen</div> },
        ]}
      />,
    );
    for (const t of ["Scan", "See", "Act"]) {
      expect(screen.getByRole("heading", { name: t })).toBeTruthy();
    }
    expect(screen.getByText("Point your camera at the collar.")).toBeTruthy();
    // The first step is active without IntersectionObserver.
    expect(screen.getByRole("heading", { name: "Scan" }).closest("li")!.hasAttribute("data-active")).toBe(true);
  });
});

describe("HungerSlider", () => {
  it("rewrites the bubble when the slider moves", () => {
    const stops = [
      { label: "Just ate", text: "Nap time." },
      { label: "Hungry", text: "Is that Parle-G?" },
      { label: "Will stare at you", text: "(Stares.)" },
    ];
    render(<HungerSlider stops={stops} defaultIndex={0} dog="Bruno" />);
    const slider = screen.getByRole("slider", { name: "How hungry is Bruno?" });
    expect(slider.getAttribute("aria-valuetext")).toBe("Just ate");
    expect(screen.getByText("Nap time.")).toBeTruthy();
    fireEvent.change(slider, { target: { value: "2" } });
    expect(screen.getByText("(Stares.)")).toBeTruthy();
    expect(screen.queryByText("Nap time.")).toBeNull();
    expect(slider.getAttribute("aria-valuetext")).toBe("Will stare at you");
  });
});

describe("CompareTable", () => {
  it("renders a heading per column and every cell", () => {
    render(
      <CompareTable
        rowLabels={["Records", "Cost"]}
        columns={[
          { id: "hetja", title: "Hetja", subtitle: "For feeders", cells: [{ bold: "Append-only" }, { bold: "Free" }] },
          { id: "ngo", title: "Hetja for NGOs", cells: [{ bold: "Verified vets" }, { bold: "Free" }] },
          { id: "none", title: "Doing nothing", cells: [{ bold: "Vibes", detail: "And a WhatsApp group." }, { bold: "Guilt" }] },
        ]}
      />,
    );
    for (const t of ["Hetja", "Hetja for NGOs", "Doing nothing"]) {
      expect(screen.getByRole("heading", { name: t })).toBeTruthy();
      expect(screen.getByRole("group", { name: t })).toBeTruthy();
    }
    expect(screen.getByText("And a WhatsApp group.")).toBeTruthy();
    expect(screen.getAllByText("Records:", { exact: false })).toHaveLength(3);
  });
});

describe("smaller pieces", () => {
  it("GroupedList makes only actionable rows interactive", () => {
    render(
      <GroupedList header="Dogs near you">
        <ListRow title="Bruno" subtitle="Dadar West" trailing="Fed 2h ago" />
        <ListRow title="Biscuit" href="/dog/biscuit" />
        <ListRow title="Kaalu" onClick={() => {}} />
      </GroupedList>,
    );
    expect(screen.getByRole("list", { name: "Dogs near you" })).toBeTruthy();
    expect(screen.getAllByRole("listitem")).toHaveLength(3);
    expect(screen.getByRole("link", { name: "Biscuit" }).getAttribute("href")).toBe("/dog/biscuit");
    expect(screen.getByRole("button", { name: "Kaalu" })).toBeTruthy();
    expect(screen.queryByRole("link", { name: /Bruno/ })).toBeNull();
  });

  it("NotifStack expands via a real aria-expanded button", () => {
    render(
      <NotifStack
        items={[
          { title: "Bruno was fed", body: "Priya · Dadar West", time: "now" },
          { title: "Rabies due Fri", body: "Biscuit", time: "2h ago" },
        ]}
      />,
    );
    const btn = screen.getByRole("button", { name: "Show all 2 notifications" });
    expect(btn.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(btn);
    expect(btn.getAttribute("aria-expanded")).toBe("true");
  });

  it("WalletPass and WardMap expose descriptive names", () => {
    render(
      <>
        <WalletPass name="Bruno" ward="Dadar West" code="H7K-2QM" vaccinated />
        <WardMap ward="Dadar West" count={14} />
      </>,
    );
    expect(screen.getByRole("article", { name: /collar pass for Bruno/ })).toBeTruthy();
    expect(screen.getByRole("img", { name: /Illustrative map of Dadar West: 14 dogs/ })).toBeTruthy();
  });
});
