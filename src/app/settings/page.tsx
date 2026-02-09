"use client";

import { useEffect, useState, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Separator } from "@/components/ui/separator";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  RefreshCw,
  Save,
  MessageCircle,
  Shield,
  FolderOpen,
  HardDrive,
  FolderTree,
  Plus,
  Trash2,
  Send,
  Globe,
} from "lucide-react";
import { toast } from "sonner";

interface DiskEntry {
  mount: string;
  label: string;
}

interface SettingsState {
  // Telegram
  telegram_bot_token: string;
  telegram_chat_id: string;
  telegram_enabled: string;
  notify_on_failure: string;
  notify_on_success: string;
  notify_daily_digest: string;
  // Rclone
  rclone_remote_name: string;
  rclone_config_path: string;
  gdrive_backup_folder: string;
  max_bandwidth: string;
  // Storage paths
  path_nextcloud_data: string;
  path_immich_data: string;
  path_immich_db_backups: string;
  path_media_library: string;
  // Disks
  disks_config: string;
  // General
  timezone: string;
}

const defaultSettings: SettingsState = {
  telegram_bot_token: "",
  telegram_chat_id: "",
  telegram_enabled: "false",
  notify_on_failure: "true",
  notify_on_success: "false",
  notify_daily_digest: "true",
  rclone_remote_name: "",
  rclone_config_path: "",
  gdrive_backup_folder: "",
  max_bandwidth: "10M",
  path_nextcloud_data: "",
  path_immich_data: "",
  path_immich_db_backups: "",
  path_media_library: "",
  disks_config: "[]",
  timezone: "Europe/Kyiv",
};

const TIMEZONE_OPTIONS = [
  { value: "Europe/Kyiv", label: "Kyiv (UTC+2 / UTC+3)" },
  { value: "Europe/Warsaw", label: "Warsaw (UTC+1 / UTC+2)" },
  { value: "Europe/Berlin", label: "Berlin (UTC+1 / UTC+2)" },
  { value: "Europe/London", label: "London (UTC+0 / UTC+1)" },
  { value: "Europe/Moscow", label: "Moscow (UTC+3)" },
  { value: "America/New_York", label: "New York (UTC-5 / UTC-4)" },
  { value: "America/Los_Angeles", label: "Los Angeles (UTC-8 / UTC-7)" },
  { value: "Asia/Tokyo", label: "Tokyo (UTC+9)" },
  { value: "UTC", label: "UTC" },
];

export default function SettingsPage() {
  const [settings, setSettings] = useState<SettingsState>(defaultSettings);
  const [disks, setDisks] = useState<DiskEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [sendingTest, setSendingTest] = useState(false);

  const fetchSettings = useCallback(async () => {
    try {
      const res = await fetch("/api/settings");
      const data = await res.json();
      const merged = { ...defaultSettings, ...data };
      setSettings(merged);
      try {
        const parsed = JSON.parse(merged.disks_config || "[]");
        setDisks(Array.isArray(parsed) ? parsed : []);
      } catch {
        setDisks([]);
      }
    } catch (e) {
      console.error("Failed to fetch settings", e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchSettings();
  }, [fetchSettings]);

  const handleSave = async () => {
    setSaving(true);
    try {
      const payload = {
        ...settings,
        disks_config: JSON.stringify(disks),
      };
      await fetch("/api/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      toast.success("Settings saved successfully");
    } catch {
      toast.error("Failed to save settings");
    } finally {
      setSaving(false);
    }
  };

  const update = (key: keyof SettingsState, value: string) => {
    setSettings((prev) => ({ ...prev, [key]: value }));
  };

  const toggleBool = (key: keyof SettingsState) => {
    setSettings((prev) => ({
      ...prev,
      [key]: prev[key] === "true" ? "false" : "true",
    }));
  };

  const addDisk = () => {
    setDisks((prev) => [...prev, { mount: "", label: "" }]);
  };

  const updateDisk = (index: number, field: keyof DiskEntry, value: string | number) => {
    setDisks((prev) => prev.map((d, i) => i === index ? { ...d, [field]: value } : d));
  };

  const removeDisk = (index: number) => {
    setDisks((prev) => prev.filter((_, i) => i !== index));
  };

  const handleTestTelegram = async () => {
    setSendingTest(true);
    try {
      const res = await fetch("/api/notifications/test", { method: "POST" });
      const data = await res.json();
      if (res.ok) {
        toast.success(data.message || "Test notification sent!");
      } else {
        toast.error(data.error || "Failed to send test notification");
      }
    } catch {
      toast.error("Network error while sending test notification");
    } finally {
      setSendingTest(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-screen">
        <RefreshCw className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="px-4 sm:px-6 lg:px-8 py-6 space-y-6 max-w-3xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Settings</h1>
          <p className="text-sm text-muted-foreground mt-1">
            All configuration is stored here — code on GitHub stays clean
          </p>
        </div>
        <Button onClick={handleSave} disabled={saving}>
          {saving ? (
            <RefreshCw className="w-4 h-4 mr-2 animate-spin" />
          ) : (
            <Save className="w-4 h-4 mr-2" />
          )}
          Save All
        </Button>
      </div>

      {/* ── Timezone ─────────────────────────────────────────── */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <Globe className="w-5 h-5 text-sky-500" />
            <div>
              <CardTitle className="text-base">Timezone</CardTitle>
              <CardDescription>All scheduled job times are interpreted in this timezone</CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <Select
            value={settings.timezone || "Europe/Kyiv"}
            onValueChange={(v) => update("timezone", v)}
          >
            <SelectTrigger className="w-64">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {TIMEZONE_OPTIONS.map((tz) => (
                <SelectItem key={tz.value} value={tz.value}>{tz.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </CardContent>
      </Card>

      {/* ── Storage Paths ────────────────────────────────────── */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <FolderTree className="w-5 h-5 text-amber-500" />
            <div>
              <CardTitle className="text-base">Storage Paths</CardTitle>
              <CardDescription>Source directories on your server (used when creating backup jobs)</CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label>Nextcloud Datadir</Label>
            <Input
              value={settings.path_nextcloud_data}
              onChange={(e) => update("path_nextcloud_data", e.target.value)}
              placeholder="/mnt/toshiba/nextcloud-data"
              className="font-mono text-sm"
            />
          </div>
          <div className="space-y-2">
            <Label>Immich Data (uploads, library)</Label>
            <Input
              value={settings.path_immich_data}
              onChange={(e) => update("path_immich_data", e.target.value)}
              placeholder="/srv/storage/transcend/immich"
              className="font-mono text-sm"
            />
          </div>
          <div className="space-y-2">
            <Label>Immich DB Backups</Label>
            <Input
              value={settings.path_immich_db_backups}
              onChange={(e) => update("path_immich_db_backups", e.target.value)}
              placeholder="/srv/storage/transcend/immich/backups"
              className="font-mono text-sm"
            />
          </div>
          <div className="space-y-2">
            <Label>Media Library (movies/series)</Label>
            <Input
              value={settings.path_media_library}
              onChange={(e) => update("path_media_library", e.target.value)}
              placeholder="/srv/storage/media"
              className="font-mono text-sm"
            />
          </div>
        </CardContent>
      </Card>

      {/* ── Disk Usage Config ────────────────────────────────── */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <HardDrive className="w-5 h-5 text-violet-500" />
              <div>
                <CardTitle className="text-base">Disk Usage</CardTitle>
                <CardDescription>Disks shown on Dashboard — sizes are auto-detected via the mount path</CardDescription>
              </div>
            </div>
            <Button variant="outline" size="sm" onClick={addDisk}>
              <Plus className="w-4 h-4 mr-1" /> Add Disk
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {disks.length === 0 && (
            <p className="text-sm text-muted-foreground text-center py-2">
              No disks configured. Click &quot;Add Disk&quot; to add your server mounts.
            </p>
          )}
          {disks.map((disk, i) => (
            <div key={i} className="grid grid-cols-[1fr_1fr_auto] gap-2 items-end">
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">Mount point (must exist in container)</Label>
                <Input
                  value={disk.mount}
                  onChange={(e) => updateDisk(i, "mount", e.target.value)}
                  placeholder="/srv/storage"
                  className="font-mono text-sm"
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">Label</Label>
                <Input
                  value={disk.label}
                  onChange={(e) => updateDisk(i, "label", e.target.value)}
                  placeholder="MEDIA"
                />
              </div>
              <Button variant="ghost" size="sm" onClick={() => removeDisk(i)} className="mb-0.5">
                <Trash2 className="w-4 h-4 text-muted-foreground" />
              </Button>
            </div>
          ))}
          {disks.length > 0 && (
            <p className="text-[11px] text-muted-foreground">
              Total/Used/Free sizes are auto-detected from the mount paths using statfs. The directories must be bind-mounted into the Docker container.
            </p>
          )}
        </CardContent>
      </Card>

      {/* ── Rclone ───────────────────────────────────────────── */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <FolderOpen className="w-5 h-5 text-emerald-500" />
            <div>
              <CardTitle className="text-base">Rclone Configuration</CardTitle>
              <CardDescription>Google Drive remote settings for backup jobs</CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label>Remote Name</Label>
            <Input
              value={settings.rclone_remote_name}
              onChange={(e) => update("rclone_remote_name", e.target.value)}
              placeholder="artem-g-drive"
              className="font-mono text-sm"
            />
            <p className="text-[11px] text-muted-foreground">
              The name you gave when running <code className="bg-accent px-1 rounded">rclone config</code> (check with <code className="bg-accent px-1 rounded">rclone listremotes</code>)
            </p>
          </div>
          <div className="space-y-2">
            <Label>Config File Path</Label>
            <Input
              value={settings.rclone_config_path}
              onChange={(e) => update("rclone_config_path", e.target.value)}
              placeholder="/home/artem/.config/rclone/rclone.conf"
              className="font-mono text-sm"
            />
            <p className="text-[11px] text-muted-foreground">
              Find with <code className="bg-accent px-1 rounded">rclone config file</code> on your server
            </p>
          </div>
          <div className="space-y-2">
            <Label>Google Drive Backup Folder</Label>
            <Input
              value={settings.gdrive_backup_folder}
              onChange={(e) => update("gdrive_backup_folder", e.target.value)}
              placeholder="homelab-backup"
              className="font-mono text-sm"
            />
            <p className="text-[11px] text-muted-foreground">
              Root folder on Google Drive for all backups. Jobs will use <code className="bg-accent px-1 rounded">remote:folder/subfolder</code>
            </p>
          </div>
          <div className="space-y-2">
            <Label>Max Bandwidth</Label>
            <Input
              value={settings.max_bandwidth}
              onChange={(e) => update("max_bandwidth", e.target.value)}
              placeholder="10M"
              className="font-mono text-sm"
            />
            <p className="text-[11px] text-muted-foreground">
              Limit upload speed (e.g. 10M = 10 MB/s). Leave empty for no limit.
            </p>
          </div>
        </CardContent>
      </Card>

      {/* ── Telegram ─────────────────────────────────────────── */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <MessageCircle className="w-5 h-5 text-blue-500" />
            <div>
              <CardTitle className="text-base">Telegram Notifications</CardTitle>
              <CardDescription>Receive alerts about backup status in Telegram</CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between">
            <Label>Enable Telegram</Label>
            <Switch
              checked={settings.telegram_enabled === "true"}
              onCheckedChange={() => toggleBool("telegram_enabled")}
            />
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={handleTestTelegram}
              disabled={sendingTest || !settings.telegram_bot_token || !settings.telegram_chat_id}
            >
              {sendingTest ? (
                <RefreshCw className="w-4 h-4 mr-2 animate-spin" />
              ) : (
                <Send className="w-4 h-4 mr-2" />
              )}
              Send Test Message
            </Button>
            {(!settings.telegram_bot_token || !settings.telegram_chat_id) && (
              <span className="text-[11px] text-muted-foreground">Fill in Bot Token and Chat ID first</span>
            )}
          </div>
          <Separator />
          <div className="space-y-2">
            <Label>Bot Token</Label>
            <Input
              type="password"
              value={settings.telegram_bot_token}
              onChange={(e) => update("telegram_bot_token", e.target.value)}
              placeholder="123456:ABCdef..."
              className="font-mono text-sm"
            />
            <p className="text-[11px] text-muted-foreground">
              Create via @BotFather in Telegram
            </p>
          </div>
          <div className="space-y-2">
            <Label>Chat ID</Label>
            <Input
              value={settings.telegram_chat_id}
              onChange={(e) => update("telegram_chat_id", e.target.value)}
              placeholder="-1001234567890"
              className="font-mono text-sm"
            />
            <p className="text-[11px] text-muted-foreground">
              Find via @userinfobot in Telegram
            </p>
          </div>
          <Separator />
          <div className="space-y-3">
            <p className="text-sm font-medium">Notification Events</p>
            <div className="flex items-center justify-between">
              <Label className="text-sm text-muted-foreground">On Failure (recommended)</Label>
              <Switch
                checked={settings.notify_on_failure === "true"}
                onCheckedChange={() => toggleBool("notify_on_failure")}
              />
            </div>
            <div className="flex items-center justify-between">
              <Label className="text-sm text-muted-foreground">On Success</Label>
              <Switch
                checked={settings.notify_on_success === "true"}
                onCheckedChange={() => toggleBool("notify_on_success")}
              />
            </div>
            <div className="flex items-center justify-between">
              <Label className="text-sm text-muted-foreground">Daily Digest</Label>
              <Switch
                checked={settings.notify_daily_digest === "true"}
                onCheckedChange={() => toggleBool("notify_daily_digest")}
              />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* ── About ────────────────────────────────────────────── */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <Shield className="w-5 h-5 text-purple-500" />
            <div>
              <CardTitle className="text-base">About</CardTitle>
              <CardDescription>Homelab Backup & Import Control Plane</CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          <div className="flex justify-between">
            <span className="text-muted-foreground">Version</span>
            <span className="font-mono">MVP 1.2.0</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Database</span>
            <span className="font-mono">SQLite (data/backup-control.db)</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Config</span>
            <span className="font-mono">Stored in DB, not in code</span>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
