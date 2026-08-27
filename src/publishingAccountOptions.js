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

function normalizeFallbackOptions(options = []) {
  return options
    .map((option) => {
      if (option !== null && typeof option === "object") {
        const value = String(option.value ?? option.name ?? option.label ?? "").trim();
        return value === "" ? null : { value, label: String(option.label ?? option.name ?? value) };
      }
      const value = String(option ?? "").trim();
      return value === "" ? null : { value, label: value };
    })
    .filter(Boolean);
}

export function getPublishingAccountFieldOptions(accounts = [], fallbackOptions = [], selectedValue = "") {
  const managedOptions = getSelectablePublishingAccounts(accounts).map((account) => ({
    id: account.id,
    value: account.name,
    label: account.platform ? `${account.name}（${account.platform}）` : account.name,
  }));
  const options = managedOptions.length > 0 ? managedOptions : normalizeFallbackOptions(fallbackOptions);
  const selected = String(selectedValue ?? "").trim();
  if (selected !== "" && !options.some((option) => option.value === selected)) {
    options.push({ value: selected, label: selected });
  }
  return options;
}

export function getPublishingAccountNames(accounts = []) {
  return getSelectablePublishingAccounts(accounts).map((account) => account.name);
}
