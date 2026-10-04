import type { HindsightBankTemplate } from "./types.js";
import type { HindsightClient } from "./client.js";

export type ApplyAction = "create" | "update" | "skip";

export interface ApplyStepResult {
  kind: "bank" | "config" | "directive" | "mental_model";
  id: string;
  action: ApplyAction;
  detail?: string;
}

export interface ApplyBankTemplateResult {
  bankId: string;
  dryRun: boolean;
  steps: ApplyStepResult[];
}

export async function applyBankTemplate(input: {
  client: HindsightClient;
  bankId: string;
  projectName: string;
  template: HindsightBankTemplate;
  dryRun?: boolean;
}): Promise<ApplyBankTemplateResult> {
  const dryRun = input.dryRun ?? false;
  const steps: ApplyStepResult[] = [];
  const bank = input.template.bank;

  const bankBody = {
    name: input.projectName,
    reflect_mission: bank.reflect_mission,
    retain_mission: bank.retain_mission,
    retain_extraction_mode: bank.retain_extraction_mode,
    enable_observations: bank.enable_observations,
    observations_mission: bank.observations_mission,
    disposition_skepticism: bank.disposition_skepticism,
    disposition_literalism: bank.disposition_literalism,
    disposition_empathy: bank.disposition_empathy,
    entities_allow_free_form: bank.entities_allow_free_form,
    entity_labels: bank.entity_labels,
  };

  if (!dryRun) {
    await input.client.createOrUpdateBank(input.bankId, bankBody);
  }
  steps.push({
    kind: "bank",
    id: input.bankId,
    action: "update",
    detail: "create-or-update bank profile",
  });

  const configUpdates: Record<string, unknown> = {
    reflect_mission: bank.reflect_mission,
    retain_mission: bank.retain_mission,
    retain_extraction_mode: bank.retain_extraction_mode,
    enable_observations: bank.enable_observations,
    observations_mission: bank.observations_mission,
    disposition_skepticism: bank.disposition_skepticism,
    disposition_literalism: bank.disposition_literalism,
    disposition_empathy: bank.disposition_empathy,
    entities_allow_free_form: bank.entities_allow_free_form,
    entity_labels: bank.entity_labels,
  };

  if (!dryRun) {
    await input.client.updateBankConfig(input.bankId, configUpdates);
  }
  steps.push({
    kind: "config",
    id: input.bankId,
    action: "update",
    detail: "mission, extraction, disposition, entity labels",
  });

  const existingDirectives = dryRun
    ? []
    : await input.client.listAllDirectives(input.bankId);
  const directivesByName = new Map(
    existingDirectives.map((d) => [d.name, d] as const),
  );

  for (const directive of input.template.directives) {
    const existing = directivesByName.get(directive.name);
    if (existing) {
      if (!dryRun) {
        await input.client.updateDirective(input.bankId, existing.id, {
          name: directive.name,
          content: directive.content,
          priority: directive.priority,
          is_active: directive.is_active,
          tags: directive.tags,
        });
      }
      steps.push({
        kind: "directive",
        id: directive.name,
        action: "update",
      });
    } else {
      if (!dryRun) {
        await input.client.createDirective(input.bankId, {
          name: directive.name,
          content: directive.content,
          priority: directive.priority,
          is_active: directive.is_active,
          tags: directive.tags,
        });
      }
      steps.push({
        kind: "directive",
        id: directive.name,
        action: "create",
      });
    }
  }

  const existingModels = dryRun
    ? []
    : await input.client.listAllMentalModels(input.bankId);
  const modelsById = new Map(existingModels.map((m) => [m.id, m] as const));

  for (const model of input.template.mental_models) {
    const existing = modelsById.get(model.id);
    if (existing) {
      if (!dryRun) {
        await input.client.updateMentalModel(input.bankId, model.id, {
          name: model.name,
          source_query: model.source_query,
          tags: model.tags,
          max_tokens: model.max_tokens,
          trigger: model.trigger,
        });
      }
      steps.push({
        kind: "mental_model",
        id: model.id,
        action: "update",
      });
    } else {
      if (!dryRun) {
        await input.client.createMentalModel(input.bankId, {
          id: model.id,
          name: model.name,
          source_query: model.source_query,
          tags: model.tags,
          max_tokens: model.max_tokens,
          trigger: model.trigger,
        });
      }
      steps.push({
        kind: "mental_model",
        id: model.id,
        action: "create",
        ...(dryRun
          ? {}
          : {
              detail:
                "create starts an async reflect; refresh again after seed if empty",
            }),
      });
    }
  }

  return {
    bankId: input.bankId,
    dryRun,
    steps,
  };
}
