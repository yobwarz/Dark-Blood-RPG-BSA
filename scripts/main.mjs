import { MODULE_ID, PAGE_ID, SangueEscuroAdapter, installInventoryBridge } from "./adapter.mjs";

Hooks.once("beavers-system-interface.init", () => {
  if (game.system.id !== "sangue-escuro") return;
  const bsi = globalThis.beaversSystemInterface;
  bsi.register(new SangueEscuroAdapter());
  installInventoryBridge(bsi);
});

Hooks.once("sangueEscuro.api", (api) => {
  if (game.system.id !== "sangue-escuro") return;
  api.registrarPagina({
    id: PAGE_ID, nome: "Fabricação", ordem: 80,
    template: `modules/${MODULE_ID}/templates/crafting.hbs`,
    contexto: () => ({ craftingAtivo: !!game.modules.get("beavers-crafting")?.active })
  });
  api.registrarPainelItem({
    id: "bsa-ferramenta", tipos: ["equipamento"],
    template: `modules/${MODULE_ID}/templates/tool.hbs`,
    contexto: (item) => ({
      ferramentaFisica: item.getFlag("sangue-escuro", "virtual") !== true,
      periciaFerramenta: item.getFlag(MODULE_ID, "periciaFerramenta") ?? "",
      periciasBsa: Object.fromEntries(Object.entries(CONFIG.SE.PERICIAS).map(([id, data]) => [id, data.nome]))
    })
  });
});

Hooks.once("ready", () => {
  if (game.system.id !== "sangue-escuro") return;
  game.modules.get(MODULE_ID).api = Object.freeze({ adapter: globalThis.beaversSystemInterface, version: game.modules.get(MODULE_ID).version });
  if (!globalThis.beaversSystemInterface) ui.notifications.error("BSA Sangue Escuro: ative Beaver's System Interface.");
});
