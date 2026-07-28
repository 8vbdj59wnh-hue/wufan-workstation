export function isPublishingAccountField(field) {
  return field?.key === "account" && String(field.label ?? "").trim() === "发布账号";
}

export function getSelectablePublishingAccounts(accounts = []) {
  return accounts
    .filter(
      (account) =>
        account?.status === "active" &&
        String(account.id ?? "").trim() !== "" &&
        String(account.name ?? "").trim() !== "",
    )
    .sort((left, right) => {
      const platformCompare = String(left.platform ?? "").localeCompare(
        String(right.platform ?? ""),
        "zh-Hans-CN",
      );
      if (platformCompare !== 0) return platformCompare;
      const nameCompare = String(left.name ?? "").localeCompare(
        String(right.name ?? ""),
        "zh-Hans-CN",
      );
      if (nameCompare !== 0) return nameCompare;
      return String(left.id).localeCompare(String(right.id));
    });
}

export function getPublishingAccountFieldOptions(accounts = []) {
  return getSelectablePublishingAccounts(accounts).map((account) => ({
    id: account.id,
    value: account.name,
    label: account.platform ? `${account.name}（${account.platform}）` : account.name,
  }));
}

export function getPublishingAccountNames(accounts = []) {
  return getSelectablePublishingAccounts(accounts).map((account) => account.name);
}
