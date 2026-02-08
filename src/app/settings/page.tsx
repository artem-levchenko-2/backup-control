"use client";

import { useEffect, useState, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Separator } from "@/components/ui/separator";
import {
  RefreshCw,
  Save,
  MessageCircle,
  Shield,
  Clock,
  Gauge,
  FolderOpen,
} from "lucide-react";
import { toast } from "sonner";

interface SettingsState {
  telegram_bot_token: string;
  telegram_chat_id: string;
  telegram_enabled: string;
  notify_on_failure: string;
  notify_on_success: string;
  notify_daily_digest: string;
  rclone_config_path: string;
  blackout_start: string;
  blackout_end: string;
  max_concurrent_jobs: string;
  max_bandwidth: string;
}

const defaultSettings: SettingsState = {
  telegram_bot_token: "",
  telegram_chat_id: "",
  telegram_enabled: "false",
  notify_on_failure: "true",
  notify_on_success: "false",
  notify_daily_digest: "true",
  rclone_config_path: "",
  blackout_start: "18:00",
  blackout_end: "23:00",
  max_concurrent_jobs: "1",
  max_bandwidth: "10M",
};

export default function SettingsPage() {
  const [settings, setSettings] = useState<SettingsState>(defaultSettings);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const fetchSettings = useCallback(async () => {
    try {
      const res = await fetch("/api/settings");
      const data = await res.json();
      setSettings({ ...defaultSettings, ...data });
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
      await fetch("/api/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(settings),
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
            Configure notifications, rclone, and system behaviour
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

      {/* Telegram */}
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
            <Label htmlFor="tg-enabled">Enable Telegram</Label>
            <Switch
              id="tg-enabled"
              checked={settings.telegram_enabled === "true"}
              onCheckedChange={() => toggleBool("telegram_enabled")}
            />
          </div>
          <Separator />
          <div className="space-y-2">
            <Label htmlFor="tg-token">Bot Token</Label>
            <Input
              id="tg-token"
              type="password"
              value={settings.telegram_bot_token}
              onChange={(e) => update("telegram_bot_token", e.target.value)}
              placeholder="123456:ABCdef..."
              className="font-mono text-sm"
            />
            <p className="text-[11px] text-muted-foreground">
              Create a bot via @BotFather in Telegram and paste the token here
            </p>
          </div>
          <div className="space-y-2">
            <Label htmlFor="tg-chat">Chat ID</Label>
            <Input
              id="tg-chat"
              value={settings.telegram_chat_id}
              onChange={(e) => update("telegram_chat_id", e.target.value)}
              placeholder="-1001234567890"
              className="font-mono text-sm"
            />
            <p className="text-[11px] text-muted-foreground">
              Your personal or group chat ID. Use @userinfobot to find it
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
              <Label className="text-sm text-muted-foreground">Daily Digest (summary once a day)</Label>
              <Switch
                checked={settings.notify_daily_digest === "true"}
                onCheckedChange={() => toggleBool("notify_daily_digest")}
              />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Rclone */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <FolderOpen className="w-5 h-5 text-emerald-500" />
            <div>
              <CardTitle className="text-base">Rclone Configuration</CardTitle>
              <CardDescription>Path to your rclone config file with Google Drive remote</CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="rclone-path">Config Path</Label>
            <Input
              id="rclone-path"
              value={settings.rclone_config_path}
              onChange={(e) => update("rclone_config_path", e.target.value)}
              placeholder="/home/user/.config/rclone/rclone.conf"
              className="font-mono text-sm"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="bandwidth">Max Bandwidth</Label>
            <Input
              id="bandwidth"
              value={settings.max_bandwidth}
              onChange={(e) => update("max_bandwidth", e.target.value)}
              placeholder="10M"
              className="font-mono text-sm"
            />
            <p className="text-[11px] text-muted-foreground">
              Limit upload speed (e.g. 10M = 10 MB/s). Leave empty for no limit
            </p>
          </div>
        </CardContent>
      </Card>

      {/* Scheduling */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <Clock className="w-5 h-5 text-orange-500" />
            <div>
              <CardTitle className="text-base">Scheduling & Limits</CardTitle>
              <CardDescription>Control when and how backups run</CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="concurrent">Max Concurrent Jobs</Label>
            <Input
              id="concurrent"
              type="number"
              min="1"
              max="4"
              value={settings.max_concurrent_jobs}
              onChange={(e) => update("max_concurrent_jobs", e.target.value)}
              className="w-24"
            />
            <p className="text-[11px] text-muted-foreground">
              How many jobs can run at the same time (recommended: 1)
            </p>
          </div>
          <Separator />
          <div className="space-y-3">
            <p className="text-sm font-medium">Blackout Window</p>
            <p className="text-[11px] text-muted-foreground">
              No heavy backups during this time (e.g. when watching Jellyfin)
            </p>
            <div className="flex items-center gap-4">
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">Start</Label>
                <Input
                  type="time"
                  value={settings.blackout_start}
                  onChange={(e) => update("blackout_start", e.target.value)}
                  className="w-32"
                />
              </div>
              <span className="text-muted-foreground mt-5">—</span>
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">End</Label>
                <Input
                  type="time"
                  value={settings.blackout_end}
                  onChange={(e) => update("blackout_end", e.target.value)}
                  className="w-32"
                />
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* System Info */}
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
            <span className="font-mono">MVP 1.0.0</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Database</span>
            <span className="font-mono">SQLite (data/backup-control.db)</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Framework</span>
            <span className="font-mono">Next.js + shadcn/ui</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Planned URL</span>
            <span className="font-mono">backup.home.arpa</span>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
