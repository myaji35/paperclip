// @vitest-environment jsdom

import { describe, expect, it } from "vitest";
import { createTranslator, startDomTranslation } from "./dom-translator";

const dict = {
  Issues: "업무",
  Done: "완료",
  Status: "상태",
  "Search issues...": "업무 검색...",
  "{0} agents running": "에이전트 {0}개 실행 중",
  "Moved to {0}": "{0}(으)로 이동",
};

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("createTranslator", () => {
  const { translate } = createTranslator(dict);

  it("translates exact, case-insensitive and trailing-punctuation matches", () => {
    expect(translate("Issues")).toBe("업무");
    expect(translate("done")).toBe("완료");
    expect(translate("Status:")).toBe("상태:");
    expect(translate("Unknown text")).toBeNull();
  });

  it("fills template slots and translates known slot values", () => {
    expect(translate("3 agents running")).toBe("에이전트 3개 실행 중");
    expect(translate("Moved to Done")).toBe("완료(으)로 이동");
  });

  it("refuses to fill a slot with untranslated English prose", () => {
    expect(translate("Moved to the old backlog")).toBeNull();
    expect(translate("Moved to Acme Labs")).toBe("Acme Labs(으)로 이동");
  });
});

describe("startDomTranslation", () => {
  it("translates UI text and attributes but leaves user content alone", async () => {
    document.body.innerHTML = `
      <nav><span id="nav"> Issues </span><input id="search" placeholder="Search issues..." /></nav>
      <div class="paperclip-markdown"><p id="md">Done</p></div>
      <code id="code">Status</code>
      <div class="mdxeditor"><div contenteditable="true"><p id="typed">Done</p></div><div class="_placeholder_x1"><p id="ph">Done</p></div></div>
      <textarea id="entry" placeholder="Search issues...">Done</textarea>
    `;
    const stop = startDomTranslation(dict, document.body);

    expect(document.getElementById("nav")!.textContent).toBe(" 업무 ");
    expect(document.getElementById("search")!.getAttribute("placeholder")).toBe("업무 검색...");
    expect(document.getElementById("md")!.textContent).toBe("Done");
    expect(document.getElementById("code")!.textContent).toBe("Status");
    expect(document.getElementById("typed")!.textContent).toBe("Done");
    expect(document.getElementById("ph")!.textContent).toBe("완료");
    expect(document.getElementById("entry")!.getAttribute("placeholder")).toBe("업무 검색...");
    expect((document.getElementById("entry") as HTMLTextAreaElement).value).toBe("Done");

    // Re-renders that write fresh English text get translated again.
    document.getElementById("nav")!.firstChild!.nodeValue = "Done";
    const added = document.createElement("span");
    added.textContent = "Status";
    document.body.appendChild(added);
    await flush();

    expect(document.getElementById("nav")!.textContent).toBe("완료");
    expect(added.textContent).toBe("상태");
    stop();
  });

  it("translates only markdown-dictionary phrases inside markdown bodies", () => {
    document.body.innerHTML = `
      <div class="paperclip-markdown">
        <p id="heading">Answered questions</p>
        <p id="user">Done</p>
        <code id="code">Answered questions</code>
      </div>
    `;
    const stop = startDomTranslation(dict, document.body, { "Answered questions": "답변한 질문" });

    expect(document.getElementById("heading")!.textContent).toBe("답변한 질문");
    expect(document.getElementById("user")!.textContent).toBe("Done");
    expect(document.getElementById("code")!.textContent).toBe("Answered questions");
    stop();
  });
});
