-- Max tool-call rounds per assistant reply, admin-managed from /admin/settings
INSERT IGNORE INTO `app_settings` (`setting_key`, `value`) VALUES ('chat.max_tool_rounds', '20');
