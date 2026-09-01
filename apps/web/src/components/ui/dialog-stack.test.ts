import { describe, expect, it } from "vitest";
import { createDialogStack } from "./dialog-stack";

describe("createDialogStack", () => {
  it("ne rend interactive que la dernière couche enregistrée", () => {
    const stack = createDialogStack<string>();

    const drawer = stack.push("drawer");
    const modal = stack.push("modal");

    expect(stack.size).toBe(2);
    expect(stack.top).toBe("modal");
    expect(stack.remove(modal)).toEqual({ removed: true, wasTop: true });
    expect(stack.top).toBe("drawer");
    expect(stack.remove(drawer)).toEqual({ removed: true, wasTop: true });
    expect(stack.top).toBeUndefined();
  });

  it("supporte le démontage désordonné et les nettoyages répétés", () => {
    const stack = createDialogStack<string>();

    const drawer = stack.push("drawer");
    stack.push("modal");

    expect(stack.remove(drawer)).toEqual({ removed: true, wasTop: false });
    expect(stack.top).toBe("modal");
    expect(stack.remove(drawer)).toEqual({ removed: false, wasTop: false });
    expect(stack.size).toBe(1);
  });
});
