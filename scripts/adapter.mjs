import { registerRecipeTests } from "./recipe-tests.mjs";

export const MODULE_ID = "bsa-sangue-escuro";
export const PAGE_ID = "fabricacao";
const TYPES = new Set(["equipamento", "arma", "protecao", "habilidade"]);
const copy = (data) => foundry.utils.deepClone(data);
const flagsKey = (flags) => {
  const clean = (value) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) return value;
    return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, clean(child)])
      .filter(([, child]) => child !== undefined && !(child && typeof child === "object" && !Array.isArray(child) && Object.keys(child).length === 0)));
  };
  return JSON.stringify(stable(clean(flags ?? {})));
};

// Ordem das propriedades não deve alterar a identidade mecânica de um item.
export function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])]));
  }
  return value;
}

export function signature(entity) {
  const system = copy(entity.toObject().system ?? {});
  delete system.quantidade;
  // Estar empunhado/vestido não muda a receita correspondente.
  delete system.equipada;
  delete system.vestida;
  return JSON.stringify(stable(system));
}

export function quantity(entity) {
  if (entity.type !== "equipamento") return 1;
  const n = entity.system.quantidade;
  if (!Number.isSafeInteger(n) || n < 0) throw Error(`Quantidade inválida: ${entity.name}.`);
  return n;
}

function assertActor(actor, skill = false) {
  if (!actor || !["character", "criatura"].includes(actor.type)) throw Error("Ator incompatível com Sangue Escuro.");
  if (!actor.isOwner) throw Error("Você não tem permissão para alterar ou testar este ator.");
  if (skill && actor.podeAgir && !actor.podeAgir()) throw Error("Este personagem não pode executar fabricação neste estado.");
  if (skill && actor.type !== "character") throw Error("Criaturas não possuem perícias de fabricação.");
}

function noCurrency(currencies) {
  if (Object.values(currencies ?? {}).some((value) => value !== 0)) {
    throw Error("Sangue Escuro não possui moedas nativas. Configure o custo como itens de equipamento.");
  }
}

export class SangueEscuroAdapter {
  id = "sangue-escuro";
  version = 2;
  async init() { registerRecipeTests(globalThis.beaversSystemInterface, this); }
  get configSkills() {
    return Object.entries(CONFIG.SE.PERICIAS).map(([id, data]) => ({ id, label: data.nome }));
  }
  get configAbilities() {
    return Object.entries(CONFIG.SE.ATRIBUTOS).map(([id, data]) => ({ id, label: data.nome }));
  }
  get configCurrencies() { return []; }
  get configCanRollAbility() { return true; }
  get configLootItemType() { return "equipamento"; }
  get itemQuantityAttribute() { return "system.quantidade"; }
  get itemPriceAttribute() { return `flags.${MODULE_ID}.preco`; }
  // Navegação é controlada pela API do Sangue Escuro; evita o changeTab("primary") do Crafting.
  get actorSheetTabSelector() { return ".bsa-navegacao-nao-utilizada"; }

  get componentDefaultData() {
    return { id: "invalid", uuid: "invalid", img: "invalid", type: "invalid", name: "invalid",
      quantity: 1, itemType: undefined, jsonData: undefined, flags: {}, seSignature: null };
  }

  componentFromEntity(entity, hasJsonData = false) {
    const isItem = entity.documentName === "Item";
    return globalThis.beaversSystemInterface.componentCreate({
      id: entity.id, uuid: entity.uuid, img: entity.img, name: entity.name,
      type: entity.documentName, itemType: isItem ? entity.type : undefined,
      quantity: isItem ? quantity(entity) : 1,
      jsonData: hasJsonData ? entity.toObject() : undefined,
      seSignature: isItem ? signature(entity) : null
    });
  }

  componentIsSame(a, b) {
    return a.name === b.name && a.type === b.type && a.itemType === b.itemType &&
      (a.seSignature == null || b.seSignature == null || a.seSignature === b.seSignature);
  }

  actorRollSkill(actor, id, dc = null) {
    assertActor(actor, true);
    if (!CONFIG.SE.PERICIAS[id] || !actor.system.pericias[id]) throw Error(`Perícia inexistente: ${id}.`);
    if (dc === null) return actor.rolarPericia(id);
    const pericia = actor.system.pericias[id];
    return actor.rolarTeste({ chave: pericia.attr, rotulo: CONFIG.SE.PERICIAS[id].nome, bonus: pericia.bonus, cd: dc });
  }

  actorRollAbility(actor, id, dc = null) {
    assertActor(actor);
    if (!CONFIG.SE.ATRIBUTOS[id] || !actor.system.atributos[id]) throw Error(`Atributo inexistente: ${id}.`);
    return dc === null ? actor.rolarAtributo(id) :
      actor.rolarTeste({ chave: id, rotulo: `Teste de ${CONFIG.SE.ATRIBUTOS[id].nome}`, cd: dc });
  }

  actorRollTool(actor, item, dc = null) {
    assertActor(actor, true);
    const id = item?.getFlag(MODULE_ID, "periciaFerramenta");
    if (!id) throw Error("Configure a perícia da ferramenta na ficha do item ou use um teste de perícia na receita.");
    const bsi = globalThis.beaversSystemInterface;
    const component = bsi.componentFromEntity(item);
    if (bsi.itemListComponentFind(actor.items, component).quantity < 1) throw Error("O ator não possui essa ferramenta.");
    return this.actorRollSkill(actor, id, dc);
  }

  actorCurrenciesGet() { return {}; }
  async actorCurrenciesStore(actor, currencies) { assertActor(actor); noCurrency(currencies); }

  actorSheetAddTab(sheet, html, actor, tabData, tabBody) {
    if (actor.type !== "character" || tabData.id !== "beavers-crafting") return;
    const root = html.jquery ? html[0] : html;
    // Crafting define activeTab antes de abrir uma fabricação por interação.
    if (sheet.activeTab === tabData.id) {
      sheet.activeTab = undefined;
      if (sheet.abaAtual !== PAGE_ID) {
        sheet.abaAtual = PAGE_ID;
        sheet.render();
        return;
      }
    }
    const host = root?.querySelector?.("[data-bsa-crafting]");
    if (!host) return;
    const body = typeof tabBody === "string" ? $(tabBody).toArray() : tabBody.jquery ? tabBody.toArray() : [tabBody];
    host.replaceChildren(...body);
    // Conteúdo adicionado depois do _onRender do sistema: impedir que seus drops importem ingredientes na ficha.
    host.addEventListener("drop", (event) => event.stopPropagation());
  }

  itemSheetReplaceContent(app, html, element) {
    const root = html.jquery ? html[0] : html;
    const sheetRoot = root?.matches?.(".se-item-ficha") ? root : root?.querySelector?.(".se-item-ficha");
    const target = sheetRoot?.querySelector?.(".se-aba-conteudo");
    if (!target) throw Error("Ficha de item não reconhecida pelo BSA Sangue Escuro.");
    target.classList.add("bsa-item-editor");
    const nodes = typeof element === "string" ? $(element).toArray() : element.jquery ? element.toArray() : [element];
    target.replaceChildren(...nodes);
  }
}

/** O BSI 2.3.x não delega actorComponentListAdd ao adaptador. Interceptação restrita a este sistema. */
export function installInventoryBridge(bsi) {
  if (bsi._bsaSangueEscuroInventory) return;
  const previous = bsi.actorComponentListAdd.bind(bsi);
  const queue = new Map();
  bsi.actorComponentListAdd = (actor, components) => {
    if (game.system.id !== "sangue-escuro") return previous(actor, components);
    const key = actor.uuid;
    const run = (queue.get(key) ?? Promise.resolve()).catch(() => {}).then(() => applyComponents(bsi, actor, components));
    queue.set(key, run);
    void run.finally(() => { if (queue.get(key) === run) queue.delete(key); }).catch(() => {});
    return run;
  };
  bsi._bsaSangueEscuroInventory = true;
}

export async function applyComponents(bsi, actor, components) {
  assertActor(actor);
  const rows = actor.items.map((item) => ({ item, component: bsi.componentFromEntity(item), left: quantity(item) }));
  const changes = { create: [], update: [], merge: [], delete: [] };
  // Resolver e validar TODAS as entradas antes de modificar documentos.
  const entries = [];
  for (const data of components) {
    if (!Number.isSafeInteger(data.quantity)) throw Error("A quantidade da receita deve ser um inteiro seguro.");
    if (data.quantity === 0) continue;
    const component = bsi.componentCreate(data);
    const entity = await component.getEntity();
    if (!entity || entity.documentName !== "Item" || !TYPES.has(entity.type)) throw Error("Resultado/ingrediente incompatível com o inventário Sangue Escuro.");
    if (entity.type !== component.itemType) throw Error("O tipo do item de origem foi alterado. Atualize a receita.");
    entries.push({ component, entity });
  }
  // Débitos não podem usar resultados que ainda serão fabricados.
  for (const { component } of entries.filter(({ component }) => component.quantity < 0)) {
    let need = -component.quantity;
    for (const row of rows) {
      if (!component.isSame(row.component) || row.left === 0) continue;
      const taken = Math.min(need, row.left);
      row.left -= taken;
      need -= taken;
      const restore = bsi.componentFromEntity(row.item, true);
      restore.quantity = taken;
      changes.delete.push(restore);
      if (!need) break;
    }
    if (need) throw Error(`Ingredientes insuficientes: ${component.name}. Nenhum item foi alterado.`);
  }
  const pending = [];
  for (const { component, entity } of entries.filter(({ component }) => component.quantity > 0)) {
    const data = copy(entity.toObject());
    delete data._id;
    delete data.folder;
    delete data.ownership;
    // Preservar marcações do Crafting (como isCrafted) e configurações de ferramenta.
    data.flags = foundry.utils.mergeObject(data.flags ?? {}, copy(component.flags ?? {}), { inplace: false });
    // Crafting é opcional: getFlag rejeita seu escopo quando está ausente/desativado.
    const stackable = entity.type === "equipamento" && !entity.flags?.["beavers-crafting"]?.subtype;
    if (stackable) {
      const equal = (candidate) => component.isSame(candidate) && candidate.isSame(component);
      const row = rows.find((row) => row.left > 0 && equal(row.component) &&
        flagsKey(row.item.toObject().flags) === flagsKey(data.flags));
      if (row) row.left += component.quantity;
      else {
        const match = pending.find((item) => item.type === data.type && item.name === data.name &&
          JSON.stringify(stable({ ...item.system, quantidade: 0 })) === JSON.stringify(stable({ ...data.system, quantidade: 0 })) &&
          flagsKey(item.flags) === flagsKey(data.flags));
        if (match) match.system.quantidade += component.quantity;
        else { data.system.quantidade = component.quantity; pending.push(data); }
      }
    } else {
      // Cada arma, proteção e habilidade é um documento independente.
      if (component.quantity > 1000) throw Error("Uma fabricação pode criar no máximo 1.000 itens individuais por operação.");
      for (let n = 0; n < component.quantity; n++) {
        const single = copy(data);
        if (entity.type === "equipamento") single.system.quantidade = 1;
        pending.push(single);
      }
    }
  }
  for (const row of rows) {
    const original = quantity(row.item);
    if (row.left === original) continue;
    if (row.left === 0) changes.merge.push(row.item.id);
    else if (row.item.type === "equipamento") {
      if (!Number.isSafeInteger(row.left)) throw Error("Quantidade final fora do limite seguro.");
      changes.update.push({ _id: row.item.id, "system.quantidade": row.left });
    }
  }
  for (const data of pending) {
    if (data.type === "equipamento" && !Number.isSafeInteger(data.system.quantidade)) throw Error("Quantidade final fora do limite seguro.");
  }
  // São operações do Foundry, sujeitas às permissões e aos hooks de outros módulos.
  if (pending.length) changes.create = await actor.createEmbeddedDocuments("Item", pending);
  if (changes.update.length) await actor.updateEmbeddedDocuments("Item", changes.update);
  if (changes.merge.length) await actor.deleteEmbeddedDocuments("Item", changes.merge);
  return changes;
}
