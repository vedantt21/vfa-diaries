const { useEffect, useMemo, useState } = React;
const e = React.createElement;

const DEFAULT_RATING = 8;
const LOGO_SRC = "logo.png";

function App() {
  const [session, setSessionState] = useState(() =>
    JSON.parse(localStorage.getItem("vfaSession") || "null"),
  );
  const [authMode, setAuthMode] = useState("login");
  const [pendingEmail, setPendingEmail] = useState("");
  const [verificationDelivery, setVerificationDelivery] = useState("");
  const [authMessage, setAuthMessage] = useState("");
  const [verifyMessage, setVerifyMessage] = useState("");
  const [status, setStatus] = useState("");
  const [entries, setEntries] = useState([]);
  const [appTab, setAppTab] = useState("diary");
  const [search, setSearch] = useState("");
  const [filterCuisine, setFilterCuisine] = useState("");
  const [filterMinRating, setFilterMinRating] = useState("");
  const [filterMaxRating, setFilterMaxRating] = useState("");
  const [filterBuyAgain, setFilterBuyAgain] = useState("");

  useEffect(() => {
    localStorage.removeItem("vfaUser");
  }, []);

  useEffect(() => {
    if (session?.token) {
      loadProfile();
      loadEntries();
    }
  }, [session?.token]);

  const visibleEntries = useMemo(() => {
    const query = search.trim().toLowerCase();
    const minRating = filterMinRating ? Number(filterMinRating) : null;
    const maxRating = filterMaxRating ? Number(filterMaxRating) : null;
    
    return entries.filter((entry) => {
      // Search filter
      if (query) {
        const haystack = [entry.dish, entry.restaurant]
          .join(" ")
          .toLowerCase();
        if (!haystack.includes(query)) {
          return false;
        }
      }
      
      // Cuisine filter
      if (filterCuisine && entry.cuisine.toLowerCase() !== filterCuisine.toLowerCase()) {
        return false;
      }
      
      // Rating range filter
      if (minRating !== null && entry.rating < minRating) {
        return false;
      }
      if (maxRating !== null && entry.rating > maxRating) {
        return false;
      }
      
      // Buy again filter
      if (filterBuyAgain === "yes" && !entry.wouldBuyAgain) {
        return false;
      }
      if (filterBuyAgain === "no" && entry.wouldBuyAgain) {
        return false;
      }
      
      return true;
    });
  }, [entries, search, filterCuisine, filterMinRating, filterMaxRating, filterBuyAgain]);

  const stats = useMemo(() => buildStats(entries), [entries]);

  function authHeaders() {
    return session?.token ? { Authorization: `Bearer ${session.token}` } : {};
  }

  function saveSession(data) {
    const nextSession = { token: data.token, user: data.user };
    setSessionState(nextSession);
    localStorage.setItem("vfaSession", JSON.stringify(nextSession));
  }

  function clearSession(note = "") {
    setSessionState(null);
    setEntries([]);
    setPendingEmail("");
    setVerificationDelivery("");
    setAuthMode("login");
    setAppTab("diary");
    setStatus("");
    setAuthMessage(note);
    localStorage.removeItem("vfaSession");
  }

  function showVerification(email, deliveryMode = "", note = "") {
    setSessionState(null);
    setEntries([]);
    setPendingEmail(email);
    setVerificationDelivery(deliveryMode);
    setVerifyMessage(note || "");
    setAuthMessage("");
    localStorage.removeItem("vfaSession");
  }

  async function handleAuthSubmit(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const formData = new FormData(form);
    const displayName = String(formData.get("displayName") || "").trim();
    const username = String(formData.get("username") || "").trim();
    const email = String(formData.get("email") || "").trim();
    const password = String(formData.get("password") || "");

    if (!email || !password || (authMode === "register" && (!displayName || !username))) {
      setAuthMessage("Add the required account details.");
      return;
    }

    const payload = { email, password };
    if (authMode === "register") {
      payload.displayName = displayName;
      payload.username = username;
    }

    const response = await fetch(`/api/auth/${authMode}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = await readJson(response);

    if (!response.ok) {
      if (data.needsVerification && data.email) {
        showVerification(data.email, data.deliveryMode, data.error);
        return;
      }
      setAuthMessage(data.error || "Could not sign in.");
      return;
    }

    if (data.needsVerification) {
      showVerification(data.email, data.deliveryMode);
      return;
    }

    saveSession(data);
    form.reset();
    setAuthMessage("");
    setAppTab("diary");
  }

  async function handleVerifySubmit(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const code = String(new FormData(form).get("code") || "").trim();
    if (!pendingEmail || !code) {
      setVerifyMessage("Enter the 6-digit code.");
      return;
    }

    const response = await fetch("/api/auth/verify", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: pendingEmail, code }),
    });
    const data = await readJson(response);

    if (!response.ok) {
      setVerifyMessage(data.error || "Could not verify email.");
      return;
    }

    saveSession(data);
    form.reset();
    setPendingEmail("");
    setVerifyMessage("");
    setAppTab("diary");
  }

  async function resendVerification() {
    if (!pendingEmail) {
      setVerifyMessage("Start registration first.");
      return;
    }

    const response = await fetch("/api/auth/resend", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: pendingEmail }),
    });
    const data = await readJson(response);

    if (!response.ok) {
      setVerifyMessage(data.error || "Could not resend code.");
      return;
    }

    setVerificationDelivery(data.deliveryMode || "");
    setVerifyMessage(verificationDeliveryText(pendingEmail, data.deliveryMode));
  }

  async function logout() {
    if (session?.token) {
      await fetch("/api/auth/logout", {
        method: "POST",
        headers: authHeaders(),
      });
    }
    clearSession();
  }

  async function loadProfile() {
    if (!session?.token) {
      return;
    }

    const response = await fetch("/api/me", { headers: authHeaders() });
    const data = await readJson(response);

    if (!response.ok) {
      handleAuthProblem(response, data);
      return;
    }

    if (data.user) {
      saveSession({ token: session.token, user: data.user });
    }
  }

  async function loadEntries() {
    if (!session?.token) {
      return;
    }

    const response = await fetch("/api/entries", { headers: authHeaders() });
    const data = await readJson(response);

    if (!response.ok) {
      if (handleAuthProblem(response, data)) {
        return;
      }
      setStatus(data.error || "Could not load entries.");
      return;
    }

    setEntries(data.entries);
  }

  async function saveEntry(event) {
    event.preventDefault();
    if (!session?.token) {
      clearSession();
      return false;
    }

    const form = event.currentTarget;
    const formData = new FormData(form);
    const rating = normalizedRating(formData.get("rating"));
    if (rating === null) {
      setStatus("Enter a rating from 0 to 10.");
      return false;
    }

    formData.set("rating", String(rating));
    formData.set("wouldBuyAgain", formData.get("wouldBuyAgain") === "yes");

    const response = await fetch("/api/entries", {
      method: "POST",
      headers: authHeaders(),
      body: formData,
    });
    const data = await readJson(response);

    if (!response.ok) {
      if (handleAuthProblem(response, data)) {
        return false;
      }
      setStatus(data.error || "Could not save entry.");
      return false;
    }

    setEntries((currentEntries) => [data.entry, ...currentEntries]);
    form.reset();
    setStatus("Saved. Future you has notes.");
    setAppTab("diary");
    return true;
  }

  async function deleteEntry(id) {
    const response = await fetch(`/api/entries/${id}`, {
      method: "DELETE",
      headers: authHeaders(),
    });
    const data = await readJson(response);

    if (!response.ok) {
      if (handleAuthProblem(response, data)) {
        return;
      }
      setStatus(data.error || "Could not delete entry.");
      return;
    }

    setEntries((currentEntries) =>
      currentEntries.filter((entry) => String(entry.id) !== String(id)),
    );
    setStatus("Entry deleted.");
  }

  function handleAuthProblem(response, data) {
    if (data.needsVerification && data.email) {
      showVerification(data.email, data.deliveryMode, data.error);
      return true;
    }
    if (response.status === 401) {
      clearSession("Please log in again.");
      return true;
    }
    return false;
  }

  if (!session?.token) {
    return e(AuthScreen, {
      authMode,
      setAuthMode,
      pendingEmail,
      verificationDelivery,
      authMessage,
      verifyMessage,
      setPendingEmail,
      onAuthSubmit: handleAuthSubmit,
      onVerifySubmit: handleVerifySubmit,
      onResend: resendVerification,
    });
  }

  return e(MainApp, {
    session,
    appTab,
    setAppTab,
    search,
    setSearch,
    entryCount: visibleEntries.length,
    entries: visibleEntries,
    hasAnyEntries: entries.length > 0,
    stats,
    status,
    onLogout: logout,
    onSaveEntry: saveEntry,
    onDeleteEntry: deleteEntry,
    filterCuisine,
    setFilterCuisine,
    filterMinRating,
    setFilterMinRating,
    filterMaxRating,
    setFilterMaxRating,
    filterBuyAgain,
    setFilterBuyAgain,
  });
}

function AuthScreen(props) {
  const showVerify = Boolean(props.pendingEmail);
  return e(
    "section",
    { className: "auth-screen", "aria-label": "Account access" },
    e(
      "div",
      { className: "auth-copy" },
      e(
        "div",
        { className: "auth-logo-frame" },
        e("img", { className: "auth-logo", src: LOGO_SRC, alt: "VFA Diaries logo" }),
      ),
      e(
        "div",
        null,
        e("h1", null, "VFA Diaries"),
        e(
          "p",
          null,
          "Sign in to keep your restaurants, ratings, comments, and buy-again notes separate from everyone else.",
        ),
        e("p", { className: "crucible-badge" }, "backed by Crucible Ventures"),
      ),
    ),
    e(
      "div",
      { className: "auth-panel" },
      showVerify
        ? e(VerifyForm, props)
        : e(AuthForm, props),
    ),
  );
}

function AuthForm({
  authMode,
  setAuthMode,
  authMessage,
  onAuthSubmit,
}) {
  const isRegistering = authMode === "register";
  return e(
    React.Fragment,
    null,
    e(
      "div",
      { className: "auth-tabs", role: "tablist", "aria-label": "Choose account mode" },
      e(
        "button",
        {
          className: `auth-tab ${!isRegistering ? "active" : ""}`,
          type: "button",
          onClick: () => setAuthMode("login"),
        },
        "Log in",
      ),
      e(
        "button",
        {
          className: `auth-tab ${isRegistering ? "active" : ""}`,
          type: "button",
          onClick: () => setAuthMode("register"),
        },
        "Create account",
      ),
    ),
    e(
      "form",
      { className: "auth-form", onSubmit: onAuthSubmit },
      e("h2", null, isRegistering ? "Create your diary" : "Welcome back"),
      isRegistering &&
        e(
          "label",
          null,
          "Name",
          e("input", {
            name: "displayName",
            autoComplete: "name",
            placeholder: "Vedant",
            required: true,
          }),
        ),
      isRegistering &&
        e(
          "label",
          null,
          "Username",
          e("input", {
            name: "username",
            autoComplete: "username",
            placeholder: "vedant_21",
            pattern: "[A-Za-z0-9_]{3,24}",
            title: "Use 3-24 letters, numbers, and underscores.",
            required: true,
          }),
        ),
      e(
        "label",
        null,
        "Email",
        e("input", {
          name: "email",
          type: "email",
          autoComplete: "email",
          placeholder: "you@example.com",
          required: true,
        }),
      ),
      e(
        "label",
        null,
        "Password",
        e("input", {
          name: "password",
          type: "password",
          autoComplete: isRegistering ? "new-password" : "current-password",
          minLength: 4,
          required: true,
        }),
      ),
      e("button", { className: "button", type: "submit" }, isRegistering ? "Create account" : "Log in"),
      e("p", { className: "message", role: "status" }, authMessage),
    ),
  );
}

function VerifyForm({
  pendingEmail,
  verificationDelivery,
  verifyMessage,
  setPendingEmail,
  onVerifySubmit,
  onResend,
}) {
  return e(
    "form",
    { className: "auth-form", onSubmit: onVerifySubmit },
    e("h2", null, "Verify your email"),
    e("p", { className: "auth-note" }, verificationDeliveryText(pendingEmail, verificationDelivery)),
    e(
      "label",
      null,
      "Verification code",
      e("input", {
        name: "code",
        inputMode: "numeric",
        maxLength: 6,
        pattern: "[0-9]{6}",
        placeholder: "123456",
        required: true,
      }),
    ),
    e(
      "div",
      { className: "verify-actions" },
      e("button", { className: "button", type: "submit" }, "Verify"),
      e(
        "button",
        { className: "button secondary", type: "button", onClick: onResend },
        "Resend code",
      ),
    ),
    e(
      "button",
      {
        className: "button ghost",
        type: "button",
        onClick: () => setPendingEmail(""),
      },
      "Back to login",
    ),
    e("p", { className: "message", role: "status" }, verifyMessage),
  );
}

function MainApp(props) {
  return e(
    "main",
    { className: "app-shell" },
    e(
      "header",
      { className: "app-header" },
      e(
        "div",
        { className: "brand" },
        e("img", {
          className: "brand-logo",
          src: LOGO_SRC,
          alt: "",
          "aria-hidden": "true",
        }),
        e(
          "div",
          null,
          e("h1", null, "VFA Diaries"),
          e("p", null, "Restaurants, cuisines, ratings, and notes in one place."),
        ),
      ),
      e(
        "div",
        { className: "session-box" },
        e(
          "div",
          { className: "profile-card", "aria-label": "User profile" },
          e("p", { className: "profile-label" }, "Signed in as"),
          e("p", { className: "profile-name" }, props.session.user.displayName),
          props.session.user.username &&
            e("p", { className: "profile-username" }, `@${props.session.user.username}`),
        ),
        e("button", { className: "button secondary", type: "button", onClick: props.onLogout }, "Log out"),
      ),
    ),
    e(
      "div",
      { className: "nav-row" },
      e(
        "nav",
        { className: "app-tabs", "aria-label": "Diary sections" },
        e(TabButton, { active: props.appTab === "diary", onClick: () => props.setAppTab("diary") }, "Diary"),
        e(TabButton, { active: props.appTab === "add", onClick: () => props.setAppTab("add") }, "Add food"),
        e(TabButton, { active: props.appTab === "stats", onClick: () => props.setAppTab("stats") }, "Stats"),
      ),
    ),
    props.appTab === "diary" &&
      e(DiaryPanel, props),
    props.appTab === "add" &&
      e(AddFoodPanel, { status: props.status, onSaveEntry: props.onSaveEntry }),
    props.appTab === "stats" &&
      e(StatsPanel, { stats: props.stats, setAppTab: props.setAppTab }),
  );
}

function TabButton({ active, onClick, children }) {
  return e(
    "button",
    {
      className: `app-tab ${active ? "active" : ""}`,
      type: "button",
      onClick,
      "aria-selected": String(active),
    },
    children,
  );
}

function StatsPanel({ stats, setAppTab }) {
  if (!stats.dishCount) {
    return e(
      "section",
      { className: "app-panel active", "aria-label": "Diary stats" },
      e(
        "div",
        { className: "stats-page" },
        e("h2", null, "Stats"),
        e(
          "div",
          { className: "empty-state visible" },
          e("img", {
            className: "empty-logo",
            src: LOGO_SRC,
            alt: "",
            "aria-hidden": "true",
          }),
          e(
            "div",
            null,
            e("h3", null, "No stats yet."),
            e("p", null, "Add a food note and this page will start filling up."),
            e("button", { className: "button secondary", type: "button", onClick: () => setAppTab("add") }, "Add food"),
          ),
        ),
      ),
    );
  }

  return e(
    "section",
    { className: "app-panel active", "aria-label": "Diary stats" },
    e(
      "div",
      { className: "stats-page" },
      e("h2", null, "Stats"),
      e("p", null, "A quick read on where your best bites and food money are going."),
      e(
        "div",
        { className: "stats-summary" },
        e(StatCard, {
          label: "Logged",
          value: `${stats.dishCount} ${stats.dishCount === 1 ? "dish" : "dishes"}`,
          detail: `${stats.restaurantCount} ${stats.restaurantCount === 1 ? "place" : "places"}, ${stats.uniqueCuisines} ${stats.uniqueCuisines === 1 ? "cuisine" : "cuisines"}`,
        }),
        e(StatCard, {
          label: "Spent",
          value: stats.pricedCount ? formatMoney(stats.totalSpent) : "--",
          detail: stats.pricedCount
            ? `${formatMoney(stats.averageSpent)} average`
            : "Add prices to unlock spend",
        }),
        e(StatCard, {
          label: "Average rating",
          value: `${formatRating(stats.averageRating)} / 10`,
          detail: `${stats.perfectCount} ${stats.perfectCount === 1 ? "dish" : "dishes"} at 9+`,
        }),
        e(StatCard, {
          label: "Buy again",
          value: `${Math.round(stats.buyAgainRate * 100)}%`,
          detail: `${stats.repeatRestaurantCount} repeat ${stats.repeatRestaurantCount === 1 ? "spot" : "spots"}`,
        }),
      ),
      e(
        "div",
        { className: "stats-highlights" },
        e(StatCard, {
          label: "Best bite",
          value: entryTitle(stats.bestEntry),
          detail: stats.bestEntry ? `${formatRating(stats.bestEntry.rating)} / 10` : "--",
        }),
        e(StatCard, {
          label: "Favorite spot",
          value: stats.topRestaurant?.label || "--",
          detail: stats.topRestaurant
            ? `${stats.topRestaurant.count} ${stats.topRestaurant.count === 1 ? "visit" : "visits"}`
            : "--",
        }),
        e(StatCard, {
          label: "Top cuisine",
          value: stats.topCuisine?.label || "--",
          detail: stats.topCuisine ? `${stats.topCuisine.count} logged` : "--",
        }),
        e(StatCard, {
          label: "Best value",
          value: entryTitle(stats.bestValueEntry),
          detail: stats.bestValueEntry
            ? `${formatRating(stats.bestValueEntry.rating)} / 10 for ${formatMoney(stats.bestValueEntry.price)}`
            : "Add prices to find it",
        }),
        e(StatCard, {
          label: "Spendiest bite",
          value: entryTitle(stats.spendiestEntry),
          detail: stats.spendiestEntry ? formatMoney(stats.spendiestEntry.price) : "Add prices to find it",
        }),
        e(StatCard, {
          label: "Current mood",
          value: stats.moodLabel,
          detail: `${stats.lowRatedCount} tough ${stats.lowRatedCount === 1 ? "call" : "calls"}`,
        }),
      ),
      e(
        "div",
        { className: "stats-breakdowns" },
        e(BreakdownPanel, {
          title: "Top cuisines",
          items: stats.cuisineBreakdown,
          emptyText: "Add cuisine tags to see your taste map.",
        }),
        e(BreakdownPanel, {
          title: "Favorite spots",
          items: stats.restaurantBreakdown,
          emptyText: "Add restaurants to see your regulars.",
        }),
        e(BreakdownPanel, {
          title: "Rating mix",
          items: stats.ratingBuckets,
          emptyText: "Rate dishes to see the spread.",
        }),
        e(BreakdownPanel, {
          title: "Spend by cuisine",
          items: stats.spendByCuisine,
          valueType: "money",
          emptyText: "Add prices and cuisines to see spend by taste.",
        }),
      ),
    ),
  );
}

function StatCard({ label, value, detail }) {
  return e(
    "article",
    { className: "stat-card" },
    e("span", null, label),
    e("strong", { title: value }, value),
    e("p", null, detail),
  );
}

function BreakdownPanel({ title, items, valueType = "count", emptyText }) {
  const maxValue = Math.max(
    1,
    ...items.map((item) => (valueType === "money" ? item.total : item.count)),
  );

  return e(
    "section",
    { className: "stats-panel" },
    e("h3", null, title),
    items.length
      ? e(
          "div",
          { className: "rank-list" },
          items.map((item) => {
            const amount = valueType === "money" ? item.total : item.count;
            const value = valueType === "money" ? formatMoney(item.total) : String(item.count);
            return e(
              "div",
              { className: "rank-row", key: item.label },
              e(
                "div",
                { className: "rank-line" },
                e("span", { title: item.label }, item.label),
                e("strong", null, value),
              ),
              e(
                "div",
                { className: "rank-track", "aria-hidden": "true" },
                e("span", { style: { width: `${amount ? Math.max(4, (amount / maxValue) * 100) : 0}%` } }),
              ),
              item.detail && e("p", null, item.detail),
            );
          }),
        )
      : e("p", { className: "stats-empty" }, emptyText),
  );
}

function DiaryPanel({
  search,
  setSearch,
  entryCount,
  entries,
  hasAnyEntries,
  setAppTab,
  onDeleteEntry,
  filterCuisine,
  setFilterCuisine,
  filterMinRating,
  setFilterMinRating,
  filterMaxRating,
  setFilterMaxRating,
  filterBuyAgain,
  setFilterBuyAgain,
}) {
  const [expandedId, setExpandedId] = useState(null);
  return e(
    "section",
    { className: "app-panel active", "aria-label": "Food diary entries" },
    e(
      "div",
      { className: "panel-block" },
      e("h2", null, "Food diary"),
      e(
        "p",
        null,
        "Scroll your saved foods and search by food or restaurant.",
      ),
      e(
        "div",
        { className: "search-row" },
        e("input", {
          type: "search",
          value: search,
          onChange: (event) => setSearch(event.target.value),
          placeholder: "Search food or restaurant...",
          "aria-label": "Search diary foods",
        }),
      ),
      e(
        "div",
        { className: "filters-row" },
        e(
          "div",
          { className: "filter-group" },
          e("label", null, "Cuisine:"),
          e(
            "select",
            {
              value: filterCuisine,
              onChange: (event) => setFilterCuisine(event.target.value),
              className: "filter-input",
            },
            e("option", { value: "" }, "All cuisines"),
            e("option", { value: "Indian" }, "Indian"),
            e("option", { value: "Lebanese" }, "Lebanese"),
            e("option", { value: "Pub" }, "Pub"),
            e("option", { value: "Cafe" }, "Cafe"),
            e("option", { value: "Chinese" }, "Chinese"),
            e("option", { value: "Thai" }, "Thai"),
            e("option", { value: "Italian" }, "Italian"),
            e("option", { value: "Japanese" }, "Japanese"),
            e("option", { value: "Mexican" }, "Mexican"),
            e("option", { value: "Korean" }, "Korean"),
            e("option", { value: "Mediterranean" }, "Mediterranean"),
            e("option", { value: "Greek" }, "Greek"),
          ),
        ),
        e(
          "div",
          { className: "filter-group" },
          e("label", null, "Min Rating:"),
          e("input", {
            type: "number",
            value: filterMinRating,
            onChange: (event) => setFilterMinRating(event.target.value),
            placeholder: "0",
            min: "0",
            max: "10",
            className: "filter-input",
          }),
        ),
        e(
          "div",
          { className: "filter-group" },
          e("label", null, "Max Rating:"),
          e("input", {
            type: "number",
            value: filterMaxRating,
            onChange: (event) => setFilterMaxRating(event.target.value),
            placeholder: "10",
            min: "0",
            max: "10",
            className: "filter-input",
          }),
        ),
        e(
          "div",
          { className: "filter-group" },
          e("label", null, "Would Buy Again:"),
          e(
            "select",
            {
              value: filterBuyAgain,
              onChange: (event) => setFilterBuyAgain(event.target.value),
              className: "filter-input",
            },
            e("option", { value: "" }, "All"),
            e("option", { value: "yes" }, "Yes"),
            e("option", { value: "no" }, "No"),
          ),
        ),
        e(
          "button",
          {
            className: "button secondary",
            type: "button",
            onClick: () => {
              setFilterCuisine("");
              setFilterMinRating("");
              setFilterMaxRating("");
              setFilterBuyAgain("");
            },
          },
          "Clear filters",
        ),
      ),
      e(
        "div",
        { className: "toolbar" },
        e("strong", null, `${entryCount} ${entryCount === 1 ? "entry" : "entries"}`),
      ),
      !hasAnyEntries
        ? e(
            "div",
            { className: "empty-state visible" },
            e("img", {
              className: "empty-logo",
              src: LOGO_SRC,
              alt: "",
              "aria-hidden": "true",
            }),
            e(
              "div",
              null,
              e("h3", null, "No food logged yet."),
              e("p", null, "Add your first restaurant note and it will stay here."),
              e("button", { className: "button secondary", type: "button", onClick: () => setAppTab("add") }, "Add food"),
            ),
          )
        : entries.length === 0
          ? e(
              "div",
              { className: "empty-state visible" },
              e("img", {
                className: "empty-logo",
                src: LOGO_SRC,
                alt: "",
                "aria-hidden": "true",
              }),
              e(
                "div",
                null,
                e("h3", null, "No matches."),
                e("p", null, "Try a different food or restaurant name."),
                e("button", { className: "button secondary", type: "button", onClick: () => setSearch("") }, "Clear search"),
              ),
            )
        : e(
            "div",
            { className: "entries" },
            entries.map((entry) =>
              e(FoodCard, {
                key: entry.id,
                entry,
                isExpanded: expandedId === entry.id,
                onToggle: () => setExpandedId(expandedId === entry.id ? null : entry.id),
                onDeleteEntry,
              }),
            ),
          ),
    ),
  );
}

function FoodCard({ entry, isExpanded, onToggle, onDeleteEntry }) {
  return e(
    "article",
    {
      className: `entry-card ${isExpanded ? "expanded" : ""}`,
      "aria-label": `${entry.dish} at ${entry.restaurant}`,
      onClick: onToggle,
      role: "button",
      tabIndex: 0,
      onKeyPress: (event) => {
        if (event.key === "Enter" || event.key === " ") {
          onToggle();
        }
      },
    },
    e(
      "div",
      { className: "entry-body" },
      e("h3", null, entry.dish),
      e("p", { className: "restaurant" }, entry.restaurant),
      e(
        "div",
        { className: "entry-meta" },
        entry.cuisine && e("span", { className: "meta-item" }, entry.cuisine),
        e("span", { className: "meta-item" }, `${entry.rating}/10`),
        entry.price !== null &&
          entry.price !== undefined &&
          e("span", { className: "meta-item" }, formatMoney(entry.price)),
        e("span", { className: "meta-item" }, entry.wouldBuyAgain ? "Would buy" : "Won't buy"),
      ),
      isExpanded && entry.comments && e("p", { className: "entry-comments" }, entry.comments),
    ),
    isExpanded &&
      e(
        "button",
        {
          className: "button ghost",
          type: "button",
          onClick: (event) => {
            event.stopPropagation();
            onDeleteEntry(entry.id);
          },
        },
        "Delete",
      ),
  );
}

function AddFoodPanel({ status, onSaveEntry }) {
  const [rating, setRating] = useState(DEFAULT_RATING);

  async function submit(event) {
    const saved = await onSaveEntry(event);
    if (saved) {
      setRating(DEFAULT_RATING);
    }
  }

  return e(
    "section",
    { className: "app-panel active", "aria-label": "Add food" },
    e(
      "div",
      { className: "panel-block form-block" },
      e("h2", null, "Add a food note"),
      e(
        "p",
        null,
        "Fill this in one step at a time, like a quick restaurant form.",
      ),
      e(
        "form",
        { className: "form-stack", onSubmit: submit },
        e(FormField, {
          className: "question-block",
          label: "Restaurant",
          name: "restaurant",
          placeholder: "Where did you go?",
          maxLength: 120,
          required: true,
        }),
        e(FormField, {
          className: "question-block",
          label: "What you ate",
          name: "dish",
          placeholder: "Dish, drink, dessert...",
          maxLength: 120,
          required: true,
        }),
        e(
          "label",
          { className: "question-block" },
          "Cuisine",
          e(
            "select",
            { name: "cuisine" },
            e("option", { value: "" }, "Select cuisine"),
            e("option", { value: "Indian" }, "Indian"),
            e("option", { value: "Lebanese" }, "Lebanese"),
            e("option", { value: "Pub" }, "Pub"),
            e("option", { value: "Cafe" }, "Cafe"),
            e("option", { value: "Chinese" }, "Chinese"),
            e("option", { value: "Thai" }, "Thai"),
            e("option", { value: "Italian" }, "Italian"),
            e("option", { value: "Japanese" }, "Japanese"),
            e("option", { value: "Mexican" }, "Mexican"),
            e("option", { value: "Korean" }, "Korean"),
            e("option", { value: "Mediterranean" }, "Mediterranean"),
            e("option", { value: "Greek" }, "Greek"),
          ),
        ),
        e(FormField, {
          className: "question-block",
          label: "Price",
          name: "price",
          type: "number",
          placeholder: "10.99",
          step: "0.01",
          min: "0",
        }),
        e(
          "label",
          { className: "question-block rating-field" },
          e(
            "span",
            { className: "label-row" },
            "Rating",
            e("span", { className: "hint" }, `${formatRating(rating)} / 10`),
          ),
          e("input", {
            name: "rating",
            type: "number",
            min: "0",
            max: "10",
            step: "0.01",
            value: rating,
            inputMode: "decimal",
            "aria-label": "Rating out of 10",
            required: true,
            onChange: (event) => setRating(event.target.value),
            onBlur: () => setRating(formatRating(clampRating(Number(rating)))),
          }),
        ),
        e(
          "label",
          { className: "question-block" },
          "Would you buy again?",
          e(
            "select",
            { name: "wouldBuyAgain", required: true },
            e("option", { value: "yes" }, "Yes"),
            e("option", { value: "no" }, "No"),
          ),
        ),
        e(
          "label",
          { className: "question-block" },
          "Comments",
          e("textarea", {
            name: "comments",
            maxLength: 600,
            placeholder: "Worth it? Too salty? Good value?",
          }),
        ),
        e(
          "div",
          { className: "actions" },
          e("button", { className: "button", type: "submit" }, "Add food"),
          e(
            "button",
            {
              className: "button secondary",
              type: "reset",
              onClick: () => setRating(DEFAULT_RATING),
            },
            "Clear",
          ),
        ),
      ),
      e("p", { className: "message", role: "status" }, status),
    ),
  );
}

function FormField({ label, className = "", ...props }) {
  return e(
    "label",
    { className },
    label,
    e("input", props),
  );
}

function normalizedRating(value) {
  const text = String(value || "").trim();
  if (!text) {
    return null;
  }

  const rating = Number(text);
  if (!Number.isFinite(rating) || rating < 0 || rating > 10) {
    return null;
  }

  return Math.round(rating * 100) / 100;
}

function clampRating(value) {
  if (!Number.isFinite(value)) {
    return DEFAULT_RATING;
  }
  return Math.min(10, Math.max(0, Math.round(value * 100) / 100));
}

function formatRating(value) {
  return Number(value).toFixed(2).replace(/\.?0+$/, "");
}

function formatMoney(value) {
  return new Intl.NumberFormat(undefined, {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2,
  }).format(Number(value) || 0);
}

function buildStats(entries) {
  const dishCount = entries.length;
  const restaurantCounts = new Map();
  const restaurantLabels = new Map();
  const cuisineCounts = new Map();
  const cuisineLabels = new Map();
  const cuisineSpend = new Map();
  let totalSpent = 0;
  let pricedCount = 0;
  let ratingTotal = 0;
  let buyAgainCount = 0;
  let bestEntry = null;
  let spendiestEntry = null;
  let bestValueEntry = null;
  let bestValueScore = -1;
  let perfectCount = 0;
  let lowRatedCount = 0;
  const ratingBuckets = [
    { label: "9-10", count: 0, detail: "great calls" },
    { label: "7-8.99", count: 0, detail: "solid picks" },
    { label: "5-6.99", count: 0, detail: "fine, not magic" },
    { label: "0-4.99", count: 0, detail: "rough ones" },
  ];

  entries.forEach((entry) => {
    const restaurantLabel = String(entry.restaurant || "").trim();
    const restaurantKey = restaurantLabel.toLowerCase();
    if (restaurantKey) {
      restaurantLabels.set(restaurantKey, restaurantLabels.get(restaurantKey) || restaurantLabel);
      incrementCount(restaurantCounts, restaurantKey);
    }

    const cuisineLabel = String(entry.cuisine || "").trim();
    const cuisineKey = cuisineLabel.toLowerCase();
    if (cuisineKey) {
      cuisineLabels.set(cuisineKey, cuisineLabels.get(cuisineKey) || cuisineLabel);
      incrementCount(cuisineCounts, cuisineKey);
    }

    if (entry.price !== null && entry.price !== undefined && entry.price !== "") {
      const price = Number(entry.price);
      if (Number.isFinite(price)) {
        totalSpent += price;
        pricedCount += 1;
        if (cuisineKey) {
          cuisineSpend.set(cuisineKey, (cuisineSpend.get(cuisineKey) || 0) + price);
        }
        if (!spendiestEntry || price > Number(spendiestEntry.price)) {
          spendiestEntry = entry;
        }

        const rating = Number(entry.rating) || 0;
        const valueScore = price > 0 ? rating / price : rating * 100;
        if (rating >= 7 && valueScore > bestValueScore) {
          bestValueScore = valueScore;
          bestValueEntry = entry;
        }
      }
    }

    const rating = Number(entry.rating) || 0;
    ratingTotal += rating;
    if (!bestEntry || rating > Number(bestEntry.rating || 0)) {
      bestEntry = entry;
    }
    if (rating >= 9) {
      perfectCount += 1;
    }
    if (rating < 7) {
      lowRatedCount += 1;
    }
    if (rating >= 9) {
      ratingBuckets[0].count += 1;
    } else if (rating >= 7) {
      ratingBuckets[1].count += 1;
    } else if (rating >= 5) {
      ratingBuckets[2].count += 1;
    } else {
      ratingBuckets[3].count += 1;
    }

    if (entry.wouldBuyAgain) {
      buyAgainCount += 1;
    }
  });

  const averageRating = dishCount ? ratingTotal / dishCount : 0;
  const buyAgainRate = dishCount ? buyAgainCount / dishCount : 0;
  const restaurantBreakdown = rankedCounts(restaurantCounts, restaurantLabels);
  const cuisineBreakdown = rankedCounts(cuisineCounts, cuisineLabels);
  const spendByCuisine = rankedMoney(cuisineSpend, cuisineLabels);
  const repeatRestaurantCount = restaurantBreakdown.filter((item) => item.count > 1).length;

  return {
    dishCount,
    restaurantCount: restaurantCounts.size,
    uniqueCuisines: cuisineCounts.size,
    pricedCount,
    totalSpent,
    averageSpent: pricedCount ? totalSpent / pricedCount : 0,
    averageRating,
    buyAgainRate,
    repeatRestaurantCount,
    perfectCount,
    lowRatedCount,
    topCuisine: cuisineBreakdown[0] || null,
    topRestaurant: restaurantBreakdown[0] || null,
    bestEntry,
    spendiestEntry,
    bestValueEntry,
    cuisineBreakdown: cuisineBreakdown.slice(0, 6),
    restaurantBreakdown: restaurantBreakdown.slice(0, 6),
    spendByCuisine: spendByCuisine.slice(0, 6),
    ratingBuckets,
    moodLabel: foodMood(averageRating, buyAgainRate),
  };
}

function incrementCount(counts, key) {
  counts.set(key, (counts.get(key) || 0) + 1);
}

function rankedCounts(counts, labels) {
  return Array.from(counts, ([key, count]) => ({
    label: labels.get(key) || key,
    count,
    detail: `${count} ${count === 1 ? "entry" : "entries"}`,
  })).sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
}

function rankedMoney(amounts, labels) {
  return Array.from(amounts, ([key, total]) => ({
    label: labels.get(key) || key,
    total,
    detail: "tracked spend",
  })).sort((a, b) => b.total - a.total || a.label.localeCompare(b.label));
}

function entryTitle(entry) {
  if (!entry) {
    return "--";
  }
  const dish = entry.dish || "Untitled dish";
  const restaurant = entry.restaurant || "Unknown spot";
  return `${dish} at ${restaurant}`;
}

function foodMood(averageRating, buyAgainRate) {
  if (averageRating >= 8.8 && buyAgainRate >= 0.75) {
    return "Hot streak";
  }
  if (averageRating >= 7.5) {
    return "Eating well";
  }
  if (buyAgainRate < 0.4) {
    return "Picky era";
  }
  return "Still exploring";
}

function verificationDeliveryText(email, deliveryMode) {
  if (deliveryMode === "terminal") {
    return `For local dev, the code for ${email} was printed in the server terminal.`;
  }
  if (deliveryMode === "email") {
    return `We sent a 6-digit code to ${email}.`;
  }
  return `Enter the 6-digit code for ${email}. Use Resend code if you need a new one.`;
}

async function readJson(response) {
  try {
    return await response.json();
  } catch {
    return { error: "Request failed." };
  }
}

ReactDOM.createRoot(document.querySelector("#root")).render(e(App));
