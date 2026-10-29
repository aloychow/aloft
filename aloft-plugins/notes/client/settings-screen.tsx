import type { PluginSurfaceProps } from "@getpaseo/plugin/client";
import { useSettings } from "@getpaseo/plugin/client";
import {
  Loading,
  SettingsAction,
  SettingsCard,
  SettingsInput,
  type SettingsInputHandle,
  SettingsRow,
  SettingsSection,
  SettingsSwitch,
} from "@getpaseo/plugin/client/ui";
import { useCallback, useMemo, useRef } from "react";
import { Text } from "react-native";
import { type NotesSettingsValues, notesSettings } from "../shared/settings";
import { useRefreshVault, useVault } from "./api";

const ignoreText = () => undefined;

export function NotesSettingsScreen({ theme }: PluginSurfaceProps) {
  const settings = useSettings(notesSettings);
  const vault = useVault();
  const refresh = useRefreshVault();
  const vaultInput = useRef<SettingsInputHandle>(null);
  const dailyInput = useRef<SettingsInputHandle>(null);
  const templateInput = useRef<SettingsInputHandle>(null);
  const errorStyle = useMemo(() => ({ color: theme.colors.statusDanger }), [theme]);

  const ready = settings.status === "ready" ? settings : null;
  const saveField = useCallback(
    async (patch: Partial<NotesSettingsValues>) => {
      if (!ready) return;
      const saved = await ready.save({ ...ready.values, ...patch }, ready.revision);
      if (saved) void refresh();
    },
    [ready, refresh],
  );
  const saveVault = useCallback(() => {
    const vaultPath = vaultInput.current?.getText();
    if (vaultPath) void saveField({ vaultPath });
  }, [saveField]);
  const saveDaily = useCallback(() => {
    void saveField({
      dailyFolder: dailyInput.current?.getText() ?? ready?.values.dailyFolder,
      dailyTemplate: templateInput.current?.getText() ?? ready?.values.dailyTemplate,
    });
  }, [ready, saveField]);
  const setAgentTools = useCallback(
    (agentTools: boolean) => void saveField({ agentTools }),
    [saveField],
  );

  if (settings.status === "loading") return <Loading />;
  if (!ready) {
    const message = "error" in settings ? String(settings.error) : "Settings are unavailable";
    return <Text style={errorStyle}>{message}</Text>;
  }

  let vaultHint = "Created on first use if it doesn't exist";
  if (vault.status?.error) vaultHint = `Can't open this folder: ${vault.status.error}`;
  else if (vault.status) vaultHint = `${vault.status.noteCount} notes in ${vault.status.vaultPath}`;

  return (
    <>
      <SettingsSection
        title="Vault"
        info="Notes are plain Markdown files in this folder. An existing Obsidian vault works as is."
      >
        <SettingsCard>
          <SettingsInput
            ref={vaultInput}
            label="Notes folder"
            hint={vaultHint}
            initialValue={ready.values.vaultPath}
            onChangeText={ignoreText}
          />
          <SettingsAction
            label="Use this folder"
            hint="Switching folders leaves the old one untouched"
            actionLabel="Save"
            onPress={saveVault}
          />
        </SettingsCard>
      </SettingsSection>
      <SettingsSection title="Daily notes">
        <SettingsCard>
          <SettingsInput
            ref={dailyInput}
            label="Daily notes folder"
            hint="Today's note is <folder>/YYYY-MM-DD.md"
            initialValue={ready.values.dailyFolder}
            onChangeText={ignoreText}
          />
          <SettingsInput
            ref={templateInput}
            label="Template"
            hint="A note in the vault. {{date}}, {{time}} and {{title}} are filled in."
            initialValue={ready.values.dailyTemplate}
            onChangeText={ignoreText}
          />
          <SettingsAction label="Daily note settings" actionLabel="Save" onPress={saveDaily} />
        </SettingsCard>
      </SettingsSection>
      <SettingsSection title="Agents">
        <SettingsCard>
          <SettingsSwitch
            label="Let agents use notes"
            hint="Agents can search, read, create and append to notes, but never delete or overwrite one. Agents receive tools only while Settings › your host › Agents › Enable Paseo tools is on."
            value={ready.values.agentTools}
            onValueChange={setAgentTools}
          />
          <SettingsRow
            label="Tools"
            hint="notes_search, notes_read, notes_recent, notes_create, notes_append"
          />
        </SettingsCard>
      </SettingsSection>
    </>
  );
}
