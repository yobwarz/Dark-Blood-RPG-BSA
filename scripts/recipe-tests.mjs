const escape = (text) => String(text).replace(/[&<>"']/g, (c) => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
})[c]);

export class RecipeTest {
  constructor(bsi, adapter, kind) {
    this.bsi = bsi;
    this.adapter = adapter;
    this.kind = kind;
    const configs = { skill: ["SkillTest", "Teste de perícia", adapter.configSkills],
      ability: ["AbilityTest", "Teste de atributo", adapter.configAbilities],
      tool: ["ToolTest", "Teste de ferramenta", []] };
    const [type, label, choices] = configs[kind];
    this.type = type;
    this.informationField = { name: "type", type: "info", label };
    this.customizationFields = {
      [kind]: kind === "tool" ? {
        name: kind, type: "text", label: "UUID da ferramenta", defaultValue: "",
        note: "UUID de um equipamento cuja perícia foi configurada na ficha do item."
      } : {
        name: kind, type: "selection", label: kind === "skill" ? "Perícia" : "Atributo",
        choices: Object.fromEntries(choices.map((c) => [c.id, { text: c.label }])),
        defaultValue: kind === "skill" ? "oficio" : "int"
      },
      dc: { name: "dc", type: "number", label: "Dificuldade (CD)", defaultValue: 12 }
    };
  }

  create(data = {}) {
    const dc = Number(data.dc ?? 12);
    if (!Number.isFinite(dc) || dc < 0) throw Error("A CD da receita deve ser um número finito e não negativo.");
    const id = data[this.kind] ?? this.customizationFields[this.kind].defaultValue;
    return {
      parent: this, data: { ...data, [this.kind]: id, dc },
      render: () => {
        const choices = this.kind === "skill" ? this.adapter.configSkills : this.adapter.configAbilities;
        const label = this.kind === "tool" ? "Ferramenta" : choices.find((c) => c.id === id)?.label ?? id;
        return `${escape(label)} — CD ${dc}`;
      },
      action: async (initiatorData) => {
        const actor = this.bsi.initiator(initiatorData).actor;
        let roll;
        if (this.kind === "tool") {
          const item = await this.bsi.uuidToDocument(id);
          roll = await this.adapter.actorRollTool(actor, item, dc);
        } else if (this.kind === "skill") roll = await this.adapter.actorRollSkill(actor, id, dc);
        else roll = await this.adapter.actorRollAbility(actor, id, dc);
        if (!roll || !Number.isFinite(roll.total)) throw Error("O teste não retornou uma rolagem válida. O projeto não avançou.");
        return roll.total >= dc ? { success: 1, fail: 0 } : { success: 0, fail: 1 };
      }
    };
  }
}

export function registerRecipeTests(bsi, adapter) {
  for (const kind of ["skill", "ability", "tool"]) bsi.registerTestClass(new RecipeTest(bsi, adapter, kind));
}
