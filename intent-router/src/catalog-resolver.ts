import { CapabilityCatalog } from "./catalog.js";
import { normalizeText } from "./normalizer.js";
import type {
  IntentName,
  NormalizedIntent,
  Resolver,
  ResolverOutcome,
  TurnRequest,
} from "./types.js";

interface ActionMatch {
  capability: string;
  intent: IntentName;
  arguments: Record<string, unknown>;
}

function actionMatch(text: string): ActionMatch | null {
  if (/(回充|回去充电|返回充电座|回家)$/.test(text)) {
    return { capability: "vacuum.dock", intent: "vacuum.dock", arguments: {} };
  }
  if (/(扫地|清扫|打扫|干活)/.test(text)) {
    return { capability: "vacuum.start", intent: "vacuum.start", arguments: {} };
  }
  if (/(关灯|关闭.*灯|灯.*关掉|熄灯)/.test(text)) {
    return { capability: "light.turn_off", intent: "light.turn_off", arguments: {} };
  }
  if (/(开灯|打开.*灯|灯.*打开|点亮)/.test(text)) {
    return { capability: "light.turn_on", intent: "light.turn_on", arguments: {} };
  }
  const temperature = text.match(/(?:调到|设为|设置到|温度)?(1[6-9]|2\d|30)(?:\.\d+)?度/);
  if (temperature?.[1]) {
    const value = Number(text.match(/(?:调到|设为|设置到|温度)?((?:1[6-9]|2\d|30)(?:\.\d+)?)度/)?.[1]);
    return {
      capability: "climate.set_temperature",
      intent: "climate.set_temperature",
      arguments: { temperature_c: value },
    };
  }
  if (/湿度(是多少|多少|怎么样|如何)?$/.test(text)) {
    return {
      capability: "sensor.read_humidity",
      intent: "sensor.read",
      arguments: { metric: "humidity" },
    };
  }
  if (/(pm2\.5|pm25|细颗粒物)(是多少|多少|怎么样|如何)?$/.test(text)) {
    return {
      capability: "sensor.read_pm25",
      intent: "sensor.read",
      arguments: { metric: "pm25" },
    };
  }
  if (/(co2|二氧化碳)(浓度)?(是多少|多少|怎么样|如何|高吗)?$/.test(text)) {
    return {
      capability: "sensor.read_co2",
      intent: "sensor.read",
      arguments: { metric: "co2" },
    };
  }
  if (/(tvoc|voc|挥发性有机物)(浓度)?(是多少|多少|怎么样|如何|高吗)?$/.test(text)) {
    return {
      capability: "sensor.read_tvoc",
      intent: "sensor.read",
      arguments: { metric: "tvoc" },
    };
  }
  if (/(温度|多少度|几度)(是多少|多少|怎么样|如何)?$/.test(text)) {
    return {
      capability: "sensor.read_temperature",
      intent: "sensor.read",
      arguments: { metric: "temperature" },
    };
  }
  if (/(启动|打开|执行).*(场景|模式)$/.test(text)) {
    return { capability: "scene.activate", intent: "scene.activate", arguments: {} };
  }
  return null;
}

function isGenericReadRequest(text: string): boolean {
  return /(查|看|读|多少|几|是什么|状态|情况|怎么样|如何|是否|有没有|剩余|不足|缺少|错误|电池|水位|等级|重量|最近事件|记录)/u.test(text);
}

export class CatalogAliasResolver implements Resolver {
  readonly id = "catalog_aliases";

  constructor(private readonly catalog: CapabilityCatalog) {}

  async resolve(request: TurnRequest): Promise<ResolverOutcome | null> {
    const text = normalizeText(request.text);
    let action = actionMatch(text);
    if (!action && isGenericReadRequest(text)) {
      action = { capability: "entity.read", intent: "entity.read", arguments: {} };
    }
    if (!action) return null;

    const candidates = this.catalog.targetsForCapability(action.capability);
    if (!candidates.length) return null;
    const named = candidates.filter((id) => {
      const target = this.catalog.target(id);
      if (!target) return false;
      return [target.display_name, ...target.aliases]
        .map((alias) => normalizeText(alias))
        .some((alias) => alias.length > 0 && text.includes(alias));
    });
    const areaMatched = named.length === 0
      ? candidates.filter((id) => {
          const area = this.catalog.target(id)?.area;
          return Boolean(area && text.includes(normalizeText(area)));
        })
      : [];
    const explicit = named.length > 0 ? named : areaMatched;
    const selected = explicit.length === 1
      ? explicit[0]
      : explicit.length === 0 && candidates.length === 1
        ? candidates[0]
        : null;
    if (!selected) {
      const names = (explicit.length ? explicit : candidates)
        .map((id) => this.catalog.target(id)?.display_name)
        .filter((name): name is string => Boolean(name));
      return {
        kind: "clarification",
        message: names.length
          ? `请明确设备：${names.join("、")}。`
          : "请明确你要控制或查询的设备。",
        errorCode: "TARGET_AMBIGUOUS",
      };
    }

    const intent: NormalizedIntent = {
      version: "1.0",
      intent: action.intent,
      target: selected,
      arguments: action.arguments,
      confidence: 1,
      needs_confirmation: false,
      clarification: null,
    };
    return { kind: "intent", intent };
  }
}
