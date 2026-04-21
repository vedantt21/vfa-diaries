declare const React: {
  createElement: (...args: any[]) => any;
  Fragment: any;
  useEffect: any;
  useMemo: any;
  useState: any;
};

declare const ReactDOM: {
  createRoot: (container: Element | null) => { render: (element: any) => void };
};

const { useEffect, useMemo, useState } = React;
const e = React.createElement;

const DEFAULT_RATING = 8;
const LOGO_SRC = "logo.png";
const COMMON_CUISINES = [
  "Indian",
  "Lebanese",
  "Pub",
  "Cafe",
  "Chinese",
  "Thai",
  "Italian",
  "Japanese",
  "Mexican",
  "Korean",
  "Mediterranean",
  "Greek",
];

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
  const [appTab, setAppTab] = useState("home");
  const [search, setSearch] = useState("");
  const [filterCuisine, setFilterCuisine] = useState("");
  const [filterMinRating, setFilterMinRating] = useState("");
  const [filterMaxRating, setFilterMaxRating] = useState("");
  const [filterBuyAgain, setFilterBuyAgain] = useState("");
  const [foodSort, setFoodSort] = useState("latest");

  useEffect(() => {
    localStorage.removeItem("vfaUser");
  }, []);

  useEffect(() => {
    if (session?.token) {
      loadProfile();
      loadEntries();
    }
  }, [session?.token]);

  const filteredEntries = useMemo(() => {
    const query = search.trim().toLowerCase();
    const minRating = filterMinRating ? Number(filterMinRating) : null;
    const maxRating = filterMaxRating ? Number(filterMaxRating) : null;
    
    return entries.filter((entry) => {
      // Search filter
      if (query) {
        const haystack = [entry.dish, entry.restaurant, entry.suburb, entry.cuisine]
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
  const foodEntries = useMemo(
    () => sortFoodEntries(filteredEntries, foodSort),
    [filteredEntries, foodSort],
  );
  const homeEntries = useMemo(() => entries.slice(0, 6), [entries]);
  const restaurants = useMemo(() => buildRestaurantDirectory(entries), [entries]);

  const stats = useMemo(() => buildStats(entries), [entries]);
  const suggestions = useMemo(() => buildSuggestionLists(entries), [entries]);

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
    setAppTab("home");
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

    const payload: {
      email: string;
      password: string;
      displayName?: string;
      username?: string;
    } = { email, password };
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
    setAppTab("home");
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
    setAppTab("home");
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
    formData.set("wouldBuyAgain", String(formData.get("wouldBuyAgain") === "yes"));

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
    setAppTab("home");
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
    entryCount: foodEntries.length,
    entries: foodEntries,
    homeEntries,
    restaurants,
    foodSort,
    setFoodSort,
    hasAnyEntries: entries.length > 0,
    stats,
    suggestions,
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
    onRefreshProfile: loadProfile,
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
      e(AuthBrandMark),
      e(
        "div",
        { className: "auth-copy-block" },
        e("p", { className: "section-kicker" }, "Food Diary"),
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

function AuthBrandMark() {
  const colors = [
    "dot-red",
    "dot-orange",
    "dot-gold",
    "dot-green",
    "dot-blue",
    "dot-violet",
  ];
  return e(
    "div",
    { className: "auth-brand-mark", "aria-hidden": "true" },
    colors.map((color, index) =>
      e("span", {
        key: color,
        className: `brand-dot ${color} dot-${index + 1}`,
      }),
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
  const [menuOpen, setMenuOpen] = useState(false);
  const socialCounts = {
    followers: props.session.user.followersCount || 0,
    following: props.session.user.followingCount || 0,
    friends: props.session.user.friendsCount || 0,
  };
  const screen = screenCopy(props.appTab, props.session.user, props.stats);

  function openTab(tab) {
    setMenuOpen(false);
    props.setAppTab(tab);
  }

  function focusFoodSearch() {
    openTab("food");
    setTimeout(() => {
      const input = document.querySelector("[data-food-search='true']") as HTMLElement | null;
      if (input) {
        input.focus();
      }
    }, 240);
  }

  function toggleMenu() {
    setMenuOpen((current) => !current);
  }

  return e(
    React.Fragment,
    null,
    e(
      "main",
      { className: `app-shell ${menuOpen ? "menu-open" : ""}` },
      e(TopBar, {
        onHome: () => openTab("home"),
        onAdd: () => openTab("add"),
        onSearch: focusFoodSearch,
        onToggleMenu: toggleMenu,
      }),
      e(SideMenu, {
        open: menuOpen,
        session: props.session,
        socialCounts,
        activeTab: props.appTab,
        onClose: () => setMenuOpen(false),
        onLogout: props.onLogout,
        onOpenTab: openTab,
      }),
      e(
        "section",
        { className: "screen-hero" },
        e("p", { className: "section-kicker" }, screen.eyebrow),
        e("h1", { className: "screen-title" }, screen.title),
        e("p", { className: "screen-copy" }, screen.copy),
        e(
          "div",
          { className: "hero-metrics" },
          screen.metrics.map((metric) =>
            e(SocialCountPill, { key: metric.label, label: metric.label, value: metric.value }),
          ),
        ),
      ),
      e(
        "div",
        { className: "screen-content" },
        props.appTab === "home" &&
          e(HomePanel, props),
        props.appTab === "food" &&
          e(FoodPanel, props),
        props.appTab === "restaurants" &&
          e(RestaurantsPanel, props),
        props.appTab === "add" &&
          e(AddFoodPanel, {
            status: props.status,
            onSaveEntry: props.onSaveEntry,
            suggestions: props.suggestions,
          }),
        props.appTab === "friends" &&
          e(FriendsPanel, { session: props.session, onRefreshProfile: props.onRefreshProfile }),
        props.appTab === "stats" &&
          e(StatsPanel, { stats: props.stats, setAppTab: props.setAppTab }),
      ),
    ),
  );
}

function SocialCountPill({ label, value }) {
  return e(
    "span",
    { className: "profile-pill" },
    e("strong", null, value),
    ` ${label}`,
  );
}

function TopBar({ onHome, onAdd, onSearch, onToggleMenu }) {
  return e(
    "header",
    { className: "top-bar" },
    e(BrandDots, { onClick: onHome }),
    e(
      "div",
      { className: "top-bar-actions" },
      e(IconButton, { label: "Add food", icon: "plus", onClick: onAdd }),
      e(IconButton, { label: "Open menu", icon: "menu", onClick: onToggleMenu }),
      e(IconButton, { label: "Search food", icon: "search", onClick: onSearch }),
    ),
  );
}

function BrandDots({ onClick }) {
  const colors = [
    "dot-red",
    "dot-orange",
    "dot-gold",
    "dot-green",
    "dot-blue",
    "dot-violet",
  ];
  return e(
    "button",
    {
      className: "brand-dots brand-dots-button",
      type: "button",
      onClick,
      "aria-label": "Go to home",
    },
    colors.map((color, index) =>
      e("span", {
        key: color,
        className: `brand-dot ${color} dot-${index + 1}`,
        "aria-hidden": "true",
      }),
    ),
  );
}

function IconButton({ label, icon, onClick }) {
  return e(
    "button",
    {
      className: "icon-button",
      type: "button",
      "aria-label": label,
      onClick,
    },
    e(TopBarIcon, { icon }),
  );
}

function TopBarIcon({ icon }) {
  if (icon === "menu") {
    return e(
      "span",
      { className: "top-icon top-icon-menu", "aria-hidden": "true" },
      e("span", null),
      e("span", null),
      e("span", null),
    );
  }
  if (icon === "search") {
    return e(
      "span",
      { className: "top-icon top-icon-search", "aria-hidden": "true" },
      e("span", { className: "search-ring" }),
      e("span", { className: "search-handle" }),
    );
  }
  return e(
    "span",
    { className: "top-icon top-icon-plus", "aria-hidden": "true" },
    e("span", null),
    e("span", null),
  );
}

function SideMenu({ open, session, socialCounts, activeTab, onClose, onLogout, onOpenTab }) {
  const mainColumns = [
    [
      { label: "Home", tab: "home", active: activeTab === "home" },
      { label: "Food", tab: "food", active: activeTab === "food" },
      { label: "Restaurants", tab: "restaurants", active: activeTab === "restaurants" },
    ],
    [
      { label: "Profile", tab: "friends", active: activeTab === "friends" },
      { label: "Diary", tab: "food", active: activeTab === "food" },
      { label: "Stats", tab: "stats", active: activeTab === "stats" },
    ],
  ];
  const lowerLinks = [
    { label: "Activity", tab: "friends", active: activeTab === "friends" },
    { label: "Food", tab: "food", active: activeTab === "food" },
  ];

  return e(
    React.Fragment,
    null,
    e("button", {
      className: `menu-backdrop ${open ? "visible" : ""}`,
      type: "button",
      "aria-label": "Close menu",
      onClick: onClose,
    }),
    e(
      "aside",
      { className: `side-menu ${open ? "open" : ""}` },
      e(
        "div",
        { className: "menu-top" },
        e("div", { className: "menu-avatar" }, initialsFromName(session.user.displayName)),
        e(
          "div",
          { className: "menu-profile-copy" },
          e("p", { className: "menu-username" }, `@${session.user.username || "diary_user"}`),
          e(
            "div",
            { className: "menu-social" },
            e(SocialCountPill, { label: "Followers", value: socialCounts.followers }),
            e(SocialCountPill, { label: "Following", value: socialCounts.following }),
            e(SocialCountPill, { label: "Friends", value: socialCounts.friends }),
          ),
        ),
      ),
      e("div", { className: "menu-divider" }),
      e(
        "div",
        { className: "menu-grid" },
        mainColumns.map((column, index) =>
          e(
            "div",
            { key: index, className: "menu-column" },
            column.map((item) =>
              e(MenuLink, {
                key: `${item.label}-${index}`,
                active: item.active,
                onClick: () => onOpenTab(item.tab),
              }, item.label),
            ),
          ),
        ),
      ),
      e("div", { className: "menu-divider" }),
      e(
        "div",
        { className: "menu-secondary" },
        e(MenuLink, { onClick: onLogout }, "Sign out"),
      ),
      e("div", { className: "menu-divider" }),
      e(
        "div",
        { className: "menu-bottom" },
        lowerLinks.map((item) =>
          e(MenuLink, {
            key: item.label,
            active: item.active,
            onClick: () => onOpenTab(item.tab),
          }, item.label),
        ),
      ),
    ),
  );
}

function MenuLink({ children, active = false, onClick }) {
  return e(
    "button",
    {
      className: `menu-link ${active ? "active" : ""}`,
      type: "button",
      onClick,
    },
    children,
  );
}

function SectionHeader({ label, title, actionLabel = "", onAction = null }) {
  return e(
    "div",
    { className: "section-header" },
    e(
      "div",
      { className: "section-header-top" },
      e("p", { className: "section-kicker" }, label),
      actionLabel &&
        e(
          "button",
          {
            className: "section-action",
            type: "button",
            onClick: onAction || (() => {}),
          },
          actionLabel,
        ),
    ),
    e("h2", { className: "section-title" }, title),
    e("div", { className: "section-line", "aria-hidden": "true" }),
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
        e(SectionHeader, { label: "Stats", title: "Your stats" }),
        e(
          "div",
          { className: "empty-state visible premium-empty-state" },
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
      e(SectionHeader, {
        label: "Stats",
        title: "Your stats",
        actionLabel: "Add food",
        onAction: () => setAppTab("add"),
      }),
      e("p", { className: "screen-subcopy" }, "A fast, premium read on where your best meals, spend, and repeat picks are clustering."),
      e(
        "div",
        { className: "stats-summary" },
        e(StatCard, {
          label: "Logged",
          value: `${stats.dishCount} ${stats.dishCount === 1 ? "dish" : "dishes"}`,
          detail: `${stats.restaurantCount} ${stats.restaurantCount === 1 ? "place" : "places"}, ${stats.uniqueSuburbs} ${stats.uniqueSuburbs === 1 ? "suburb" : "suburbs"}`,
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
          label: "Top suburb",
          value: stats.topSuburb?.label || "--",
          detail: stats.topSuburb ? `${stats.topSuburb.count} logged` : "--",
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
          title: "Top suburbs",
          items: stats.suburbBreakdown,
          emptyText: "Add suburbs to see your food map.",
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

function HomePanel({
  session,
  homeEntries,
  restaurants,
  stats,
  hasAnyEntries,
  setAppTab,
  onDeleteEntry,
}) {
  const [expandedId, setExpandedId] = useState(null);
  const topRestaurants = restaurants.slice(0, 4);

  if (!hasAnyEntries) {
    return e(
      "section",
      { className: "app-panel active", "aria-label": "Home" },
      e(
        "div",
        { className: "panel-block home-panel-block" },
        e(SectionHeader, {
          label: "Home",
          title: "Start your diary",
          actionLabel: "Add food",
          onAction: () => setAppTab("add"),
        }),
        e(
          "div",
          { className: "empty-state visible premium-empty-state" },
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
            e("p", null, "Add your first restaurant note and your home feed will start filling up."),
            e("button", { className: "button secondary", type: "button", onClick: () => setAppTab("add") }, "Add food"),
          ),
        ),
      ),
    );
  }

  return e(
    "section",
    { className: "app-panel active", "aria-label": "Home" },
    e(
      "div",
      { className: "panel-stack" },
      e(
        "div",
        { className: "panel-block home-panel-block" },
        e(SectionHeader, {
          label: "New from diary",
          title: "Recent food posters",
          actionLabel: "See all food",
          onAction: () => setAppTab("food"),
        }),
        e(
          "div",
          { className: "entries poster-grid" },
          homeEntries.map((entry) =>
            e(FoodCard, {
              key: entry.id,
              entry,
              viewerUsername: session?.user?.username,
              isExpanded: expandedId === entry.id,
              onToggle: () => setExpandedId(expandedId === entry.id ? null : entry.id),
              onDeleteEntry,
            }),
          ),
        ),
      ),
      e(
        "div",
        { className: "panel-block home-panel-block" },
        e(SectionHeader, {
          label: "Restaurants",
          title: "Most visited spots",
          actionLabel: "All restaurants",
          onAction: () => setAppTab("restaurants"),
        }),
        e(
          "div",
          { className: "restaurant-grid" },
          topRestaurants.map((restaurant) =>
            e(RestaurantCard, { key: restaurant.key, restaurant }),
          ),
        ),
      ),
      e(
        "div",
        { className: "home-stats-strip" },
        e(StatCard, {
          label: "Average rating",
          value: `${formatRating(stats.averageRating)} / 10`,
          detail: `${stats.perfectCount} ${stats.perfectCount === 1 ? "great hit" : "great hits"}`,
        }),
        e(StatCard, {
          label: "Favorite cuisine",
          value: stats.topCuisine?.label || "Still exploring",
          detail: stats.topCuisine ? `${stats.topCuisine.count} logged` : "Add a few more meals",
        }),
        e(StatCard, {
          label: "Return rate",
          value: `${Math.round(stats.buyAgainRate * 100)}%`,
          detail: `${stats.repeatRestaurantCount} repeat ${stats.repeatRestaurantCount === 1 ? "spot" : "spots"}`,
        }),
      ),
    ),
  );
}

function FoodPanel({
  session,
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
  foodSort,
  setFoodSort,
  suggestions,
}) {
  const [expandedId, setExpandedId] = useState(null);
  return e(
    "section",
    { className: "app-panel active", "aria-label": "Food diary entries" },
    e(
      "div",
      { className: "panel-block diary-block" },
      e(SectionHeader, {
        label: "Food",
        title: "Your full food library",
        actionLabel: `${entryCount} ${entryCount === 1 ? "entry" : "entries"}`,
      }),
      e(
        "div",
        { className: "search-row premium-search-row" },
        e("input", {
          type: "search",
          value: search,
          onChange: (event) => setSearch(event.target.value),
          placeholder: "Search dishes, suburbs, restaurants...",
          "aria-label": "Search diary foods",
          "data-food-search": "true",
        }),
      ),
      e(
        "div",
        { className: "filters-row premium-filter-row" },
        e(
          "div",
          { className: "filter-group" },
          e("label", null, "Sort"),
          e(
            "select",
            {
              value: foodSort,
              onChange: (event) => setFoodSort(event.target.value),
              className: "filter-input",
            },
            e("option", { value: "latest" }, "Latest"),
            e("option", { value: "rating_desc" }, "Highest rated"),
            e("option", { value: "rating_asc" }, "Lowest rated"),
            e("option", { value: "restaurant_az" }, "Restaurant A-Z"),
            e("option", { value: "dish_az" }, "Dish A-Z"),
            e("option", { value: "price_desc" }, "Most expensive"),
          ),
        ),
        e(
          "div",
          { className: "filter-group" },
          e("label", null, "Cuisine"),
          e(
            "select",
            {
              value: filterCuisine,
              onChange: (event) => setFilterCuisine(event.target.value),
              className: "filter-input",
            },
            e("option", { value: "" }, "All cuisines"),
            suggestions.cuisines.map((cuisine) =>
              e("option", { key: cuisine, value: cuisine }, cuisine),
            ),
          ),
        ),
        e(
          "div",
          { className: "filter-group" },
          e("label", null, "Min rating"),
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
          e("label", null, "Max rating"),
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
          e("label", null, "Buy again"),
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
              setFoodSort("latest");
            },
            },
          "Reset",
        ),
      ),
      !hasAnyEntries
        ? e(
            "div",
            { className: "empty-state visible premium-empty-state" },
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
              { className: "empty-state visible premium-empty-state" },
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
            { className: "entries poster-grid" },
            entries.map((entry) =>
              e(FoodCard, {
                key: entry.id,
                entry,
                viewerUsername: session?.user?.username,
                isExpanded: expandedId === entry.id,
                onToggle: () => setExpandedId(expandedId === entry.id ? null : entry.id),
                onDeleteEntry,
              }),
            ),
          ),
    ),
  );
}

function RestaurantsPanel({ restaurants, hasAnyEntries, setAppTab }) {
  return e(
    "section",
    { className: "app-panel active", "aria-label": "Restaurants" },
    e(
      "div",
      { className: "panel-block restaurants-panel-block" },
      e(SectionHeader, {
        label: "Restaurants",
        title: "Every place you've visited",
        actionLabel: `${restaurants.length} ${restaurants.length === 1 ? "spot" : "spots"}`,
      }),
      !hasAnyEntries
        ? e(
            "div",
            { className: "empty-state visible premium-empty-state" },
            e("img", {
              className: "empty-logo",
              src: LOGO_SRC,
              alt: "",
              "aria-hidden": "true",
            }),
            e(
              "div",
              null,
              e("h3", null, "No restaurants yet."),
              e("p", null, "Once you add a food note, every restaurant you visit will show up here."),
              e("button", { className: "button secondary", type: "button", onClick: () => setAppTab("add") }, "Add food"),
            ),
          )
        : e(
            "div",
            { className: "restaurant-directory" },
            restaurants.map((restaurant) =>
              e(RestaurantCard, { key: restaurant.key, restaurant, detailed: true }),
            ),
          ),
    ),
  );
}

function RestaurantCard({ restaurant, detailed = false }) {
  return e(
    "article",
    { className: `restaurant-card ${detailed ? "detailed" : ""}` },
    e(
      "div",
      { className: "restaurant-card-top" },
      e(
        "div",
        { className: "restaurant-card-copy" },
        e("p", { className: "restaurant-kicker" }, restaurant.primaryCuisine || "Restaurant"),
        e("h3", { className: "restaurant-title" }, restaurant.name),
        e("p", { className: "restaurant-subtitle" }, restaurant.suburb || "Location not logged"),
      ),
      e(
        "div",
        { className: "restaurant-rating" },
        e("strong", null, `${formatRating(restaurant.averageRating)}/10`),
        e("div", { className: "star-row", "aria-hidden": "true" }, ratingStars(restaurant.averageRating)),
      ),
    ),
    e(
      "div",
      { className: "restaurant-meta" },
      e("span", { className: "meta-item" }, `${restaurant.visits} ${restaurant.visits === 1 ? "visit" : "visits"}`),
      restaurant.latestDish && e("span", { className: "meta-item" }, restaurant.latestDish),
      restaurant.latestDate && e("span", { className: "meta-item" }, `Last ${formatSocialDate(restaurant.latestDate)}`),
      restaurant.buyAgainRate > 0 &&
        e("span", { className: "meta-item" }, `${Math.round(restaurant.buyAgainRate * 100)}% buy again`),
    ),
    detailed &&
      e("p", { className: "restaurant-note" }, restaurant.note),
  );
}

function FoodCard({ entry, viewerUsername, isExpanded, onToggle, onDeleteEntry }) {
  const username = viewerUsername || entry.username || "you";
  const stars = ratingStars(entry.rating);
  return e(
    "article",
    {
      className: `entry-card poster-card ${isExpanded ? "expanded" : ""}`,
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
      { className: "poster-art", style: posterArtStyle(entry) },
      e("span", { className: "poster-kicker" }, entry.cuisine || entry.suburb || entry.restaurant),
      e("h3", { className: "poster-title" }, entry.dish),
      e("p", { className: "poster-subtitle" }, entry.restaurant),
      e("span", { className: "poster-score" }, `${formatRating(entry.rating)}/10`),
    ),
    e(
      "div",
      { className: "poster-body" },
      e(
        "div",
        { className: "poster-meta-row" },
        e("p", { className: "card-username" }, `@${username}`),
        e("div", { className: "star-row", "aria-label": `${formatRating(entry.rating)} out of 10` }, stars),
      ),
      e(
        "div",
        { className: "entry-meta" },
        entry.suburb && e("span", { className: "meta-item" }, entry.suburb),
        entry.price !== null &&
          entry.price !== undefined &&
          e("span", { className: "meta-item" }, formatMoney(entry.price)),
        e("span", { className: "meta-item" }, entry.wouldBuyAgain ? "Buy again" : "One-time"),
        e("span", { className: "meta-item" }, visibilityLabel(entry.visibility)),
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

function AddFoodPanel({ status, onSaveEntry, suggestions }) {
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
      { className: "panel-block form-block add-food-block" },
      e(SectionHeader, {
        label: "Capture",
        title: "Add a food note",
      }),
      e("p", { className: "screen-subcopy" }, "A clean one-pass form for the dish, the place, the score, and whether it deserves a return trip."),
      e(
        "form",
        { className: "form-stack premium-form-stack", onSubmit: submit },
        e(Datalist, { id: "restaurant-options", options: suggestions.restaurants }),
        e(Datalist, { id: "suburb-options", options: suggestions.suburbs }),
        e(Datalist, { id: "dish-options", options: suggestions.dishes }),
        e(Datalist, { id: "cuisine-options", options: suggestions.cuisines }),
        e(FormField, {
          className: "question-block",
          label: "Restaurant",
          name: "restaurant",
          list: "restaurant-options",
          placeholder: "Where did you go?",
          maxLength: 120,
          required: true,
        }),
        e(FormField, {
          className: "question-block",
          label: "Suburb",
          name: "suburb",
          list: "suburb-options",
          placeholder: "Which suburb?",
          maxLength: 80,
        }),
        e(FormField, {
          className: "question-block",
          label: "What you ate",
          name: "dish",
          list: "dish-options",
          placeholder: "Dish, drink, dessert...",
          maxLength: 120,
          required: true,
        }),
        e(FormField, {
          className: "question-block",
          label: "Cuisine",
          name: "cuisine",
          list: "cuisine-options",
          placeholder: "Start typing or choose one...",
          maxLength: 80,
        }),
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
          "Who can see this?",
          e(
            "select",
            { name: "visibility", required: true },
            e("option", { value: "private" }, "🔒 Private (only me)"),
            e("option", { value: "friends_only" }, "👥 Friends only (my followers)"),
            e("option", { value: "public" }, "🌐 Public (everyone)"),
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

function FriendsPanel({ session, onRefreshProfile }) {
  const [activeTab, setActiveTab] = useState("activity");
  const [searchTerm, setSearchTerm] = useState("");
  const [searchResults, setSearchResults] = useState([]);
  const [pendingRequests, setPendingRequests] = useState([]);
  const [followers, setFollowers] = useState([]);
  const [following, setFollowing] = useState([]);
  const [friends, setFriends] = useState([]);
  const [feedEntries, setFeedEntries] = useState([]);
  const [socialCounts, setSocialCounts] = useState(() => socialCountsFromUser(session.user));
  const [loading, setLoading] = useState(false);
  const [activeAction, setActiveAction] = useState("");
  const [panelStatus, setPanelStatus] = useState("");

  useEffect(() => {
    setSocialCounts(socialCountsFromUser(session.user));
  }, [
    session.user.followersCount,
    session.user.followingCount,
    session.user.friendsCount,
    session.user.pendingCount,
  ]);

  useEffect(() => {
    if (activeTab === "activity") {
      loadFeed();
      return;
    }
    if (activeTab === "requests") {
      loadRelationshipList("pending", setPendingRequests);
      return;
    }
    if (activeTab === "followers") {
      loadRelationshipList("followers", setFollowers);
      return;
    }
    if (activeTab === "following") {
      loadRelationshipList("following", setFollowing);
      return;
    }
    if (activeTab === "friends") {
      loadRelationshipList("friends", setFriends);
    }
  }, [activeTab]);

  function authHeaders() {
    return session?.token ? { Authorization: `Bearer ${session.token}` } : {};
  }

  function mergeCounts(counts) {
    if (!counts) {
      return;
    }
    setSocialCounts((current) => ({ ...current, ...counts }));
  }

  async function refreshProfile() {
    if (onRefreshProfile) {
      await onRefreshProfile();
    }
  }

  async function loadRelationshipList(type, setter) {
    setLoading(true);
    const response = await fetch(`/api/follows?type=${encodeURIComponent(type)}`, {
      headers: authHeaders(),
    });
    const data = await readJson(response);
    setLoading(false);

    if (!response.ok) {
      setPanelStatus(data.error || "Could not load this list.");
      return;
    }

    setter(data.follows || []);
    mergeCounts(data.counts);
    setPanelStatus("");
  }

  async function loadFeed() {
    setLoading(true);
    const response = await fetch("/api/feed", { headers: authHeaders() });
    const data = await readJson(response);
    setLoading(false);

    if (!response.ok) {
      setPanelStatus(data.error || "Could not load activity.");
      return;
    }

    setFeedEntries(data.entries || []);
    setPanelStatus("");
  }

  async function handleSearch(event) {
    event.preventDefault();
    if (searchTerm.trim().length < 2) {
      setPanelStatus("Search with at least 2 characters.");
      return;
    }

    setLoading(true);
    const response = await fetch(`/api/users?q=${encodeURIComponent(searchTerm.trim())}`, {
      headers: authHeaders(),
    });
    const data = await readJson(response);
    setLoading(false);

    if (!response.ok) {
      setPanelStatus(data.error || "Could not search users.");
      return;
    }

    setSearchResults(data.users || []);
    setPanelStatus(data.users?.length ? "" : "No matching people yet.");
  }

  async function performRelationshipAction(username, action, successMessage, onSuccess = null) {
    setActiveAction(`${action}:${username}`);
    const response = await fetch(`/api/follows/${username}/${action}`, {
      method: "POST",
      headers: authHeaders(),
    });
    const data = await readJson(response);
    setActiveAction("");

    if (!response.ok) {
      setPanelStatus(data.error || "That action could not be completed.");
      return null;
    }

    setPanelStatus(successMessage);
    if (onSuccess) {
      onSuccess(data);
    }
    await refreshProfile();
    return data;
  }

  async function followUser(username) {
    await performRelationshipAction(
      username,
      "follow",
      "Relationship updated.",
      (data) => {
        setSearchResults((current) =>
          current.map((user) =>
            user.username === username
              ? {
                  ...user,
                  followStatus: data.status,
                  hasIncomingRequest: false,
                  followsYou: data.status === "accepted" ? true : user.followsYou,
                  isFriend: Boolean(data.isFriend),
                }
              : user,
          ),
        );
      },
    );
  }

  async function acceptFollowRequest(username) {
    const data = await performRelationshipAction(
      username,
      "accept",
      "Request accepted.",
    );
    if (!data) {
      return;
    }
    await loadRelationshipList("pending", setPendingRequests);
    if (activeTab === "followers") {
      await loadRelationshipList("followers", setFollowers);
    }
    if (activeTab === "friends") {
      await loadRelationshipList("friends", setFriends);
    }
  }

  async function rejectFollowRequest(username) {
    const data = await performRelationshipAction(
      username,
      "reject",
      "Request removed.",
    );
    if (!data) {
      return;
    }
    await loadRelationshipList("pending", setPendingRequests);
  }

  async function unfollowUser(username) {
    const data = await performRelationshipAction(
      username,
      "unfollow",
      "You are no longer following them.",
      () => {
        setSearchResults((current) =>
          current.map((user) =>
            user.username === username
              ? { ...user, followStatus: null, isFriend: false }
              : user,
          ),
        );
      },
    );
    if (!data) {
      return;
    }
    await loadRelationshipList("following", setFollowing);
    if (activeTab === "friends") {
      await loadRelationshipList("friends", setFriends);
    }
    await loadFeed();
  }

  async function removeFollower(username) {
    const data = await performRelationshipAction(
      username,
      "remove",
      "Follower removed.",
      () => {
        setSearchResults((current) =>
          current.map((user) =>
            user.username === username
              ? { ...user, followsYou: false, hasIncomingRequest: false, isFriend: false }
              : user,
          ),
        );
      },
    );
    if (!data) {
      return;
    }
    await loadRelationshipList("followers", setFollowers);
    if (activeTab === "friends") {
      await loadRelationshipList("friends", setFriends);
    }
  }

  return e(
    "section",
    { className: "app-panel active", "aria-label": "Friends and activity" },
    e(
      "div",
      { className: "panel-block friends-panel-block" },
      e(SectionHeader, {
        label: "Social",
        title: "Friends and activity",
        actionLabel: "All activity",
        onAction: () => setActiveTab("activity"),
      }),
      e("p", { className: "friends-intro screen-subcopy" }, "Build your own food-circle: follow people, follow back, and keep up with what they rate."),
      e(
        "div",
        { className: "friends-summary-grid" },
        e(SocialSummaryCard, { label: "Followers", value: socialCounts.followersCount }),
        e(SocialSummaryCard, { label: "Following", value: socialCounts.followingCount }),
        e(SocialSummaryCard, { label: "Friends", value: socialCounts.friendsCount }),
        e(SocialSummaryCard, { label: "Requests", value: socialCounts.pendingCount }),
      ),
      e(
        "div",
        { className: "friends-tabs" },
        e(FriendsTabButton, {
          active: activeTab === "activity",
          label: "Activity",
          onClick: () => setActiveTab("activity"),
        }),
        e(FriendsTabButton, {
          active: activeTab === "discover",
          label: "Discover",
          onClick: () => setActiveTab("discover"),
        }),
        e(FriendsTabButton, {
          active: activeTab === "requests",
          label: `Requests (${socialCounts.pendingCount})`,
          onClick: () => setActiveTab("requests"),
        }),
        e(FriendsTabButton, {
          active: activeTab === "followers",
          label: `Followers (${socialCounts.followersCount})`,
          onClick: () => setActiveTab("followers"),
        }),
        e(FriendsTabButton, {
          active: activeTab === "following",
          label: `Following (${socialCounts.followingCount})`,
          onClick: () => setActiveTab("following"),
        }),
        e(FriendsTabButton, {
          active: activeTab === "friends",
          label: `Friends (${socialCounts.friendsCount})`,
          onClick: () => setActiveTab("friends"),
        }),
      ),
      e("p", { className: "message friends-message", role: "status" }, panelStatus),
      activeTab === "activity" &&
        e(
          "div",
          { className: "friends-content" },
          loading && e("p", { className: "empty-message" }, "Loading activity..."),
          !loading &&
            (feedEntries.length > 0
              ? e(
                  "div",
                  { className: "feed-list poster-grid" },
                  feedEntries.map((entry) =>
                    e(FeedPosterCard, { key: `${entry.id}-${entry.username}`, entry }),
                  ),
                )
              : e("p", { className: "empty-message" }, "No activity yet. Follow a few people to get their public and friends-only food notes here.")),
        ),
      activeTab === "discover" &&
        e(
          "div",
          { className: "friends-content" },
          e(
            "form",
            { onSubmit: handleSearch, className: "search-form" },
            e("input", {
              type: "text",
              placeholder: "Search by username or display name...",
              value: searchTerm,
              onChange: (event) => setSearchTerm(event.target.value),
              className: "filter-input",
            }),
            e("button", { type: "submit", className: "button", disabled: loading }, loading ? "Searching..." : "Search"),
          ),
          searchResults.length > 0
            ? e(
                "div",
                { className: "search-results" },
                searchResults.map((user) =>
                  e(
                    SocialUserCard,
                    {
                      key: user.username,
                      user,
                      actionArea: discoverActionArea({
                        user,
                        activeAction,
                        onFollow: followUser,
                        onAccept: acceptFollowRequest,
                      }),
                    },
                  ),
                ),
              )
            : e("p", { className: "empty-message" }, "Search for someone to start building your food network."),
        ),
      activeTab === "requests" &&
        e(
          "div",
          { className: "friends-content" },
          loading && e("p", { className: "empty-message" }, "Loading requests..."),
          !loading &&
            (pendingRequests.length > 0
              ? pendingRequests.map((user) =>
                  e(SocialUserCard, {
                    key: user.username,
                    user,
                    actionArea: e(
                      "div",
                      { className: "request-actions" },
                      e("button", {
                        className: "button",
                        type: "button",
                        disabled: activeAction === `accept:${user.username}`,
                        onClick: () => acceptFollowRequest(user.username),
                      }, activeAction === `accept:${user.username}` ? "Accepting..." : "Accept"),
                      e("button", {
                        className: "button secondary",
                        type: "button",
                        disabled: activeAction === `reject:${user.username}`,
                        onClick: () => rejectFollowRequest(user.username),
                      }, activeAction === `reject:${user.username}` ? "Declining..." : "Decline"),
                    ),
                  }))
              : e("p", { className: "empty-message" }, "No pending requests.")),
        ),
      activeTab === "followers" &&
        e(
          "div",
          { className: "friends-content" },
          loading && e("p", { className: "empty-message" }, "Loading followers..."),
          !loading &&
            (followers.length > 0
              ? followers.map((user) =>
                  e(SocialUserCard, {
                    key: user.username,
                    user,
                    actionArea: e(
                      "div",
                      { className: "request-actions" },
                      user.followStatus === "accepted"
                        ? e("button", {
                            className: "button secondary",
                            type: "button",
                            disabled: activeAction === `unfollow:${user.username}`,
                            onClick: () => unfollowUser(user.username),
                          }, activeAction === `unfollow:${user.username}` ? "Updating..." : "Unfollow")
                        : e("button", {
                            className: "button",
                            type: "button",
                            disabled: activeAction === `follow:${user.username}`,
                            onClick: () => followUser(user.username),
                          }, activeAction === `follow:${user.username}` ? "Following..." : "Follow back"),
                      e("button", {
                        className: "button secondary",
                        type: "button",
                        disabled: activeAction === `remove:${user.username}`,
                        onClick: () => removeFollower(user.username),
                      }, activeAction === `remove:${user.username}` ? "Removing..." : "Remove"),
                    ),
                  }))
              : e("p", { className: "empty-message" }, "No followers yet.")),
        ),
      activeTab === "following" &&
        e(
          "div",
          { className: "friends-content" },
          loading && e("p", { className: "empty-message" }, "Loading following..."),
          !loading &&
            (following.length > 0
              ? following.map((user) =>
                  e(SocialUserCard, {
                    key: user.username,
                    user,
                    actionArea: e("button", {
                      className: "button secondary",
                      type: "button",
                      disabled: activeAction === `unfollow:${user.username}`,
                      onClick: () => unfollowUser(user.username),
                    }, activeAction === `unfollow:${user.username}` ? "Updating..." : "Unfollow"),
                  }))
              : e("p", { className: "empty-message" }, "You are not following anyone yet.")),
        ),
      activeTab === "friends" &&
        e(
          "div",
          { className: "friends-content" },
          loading && e("p", { className: "empty-message" }, "Loading friends..."),
          !loading &&
            (friends.length > 0
              ? friends.map((user) =>
                  e(SocialUserCard, {
                    key: user.username,
                    user,
                    actionArea: e(
                      "div",
                      { className: "request-actions" },
                      e("button", {
                        className: "button secondary",
                        type: "button",
                        disabled: activeAction === `unfollow:${user.username}`,
                        onClick: () => unfollowUser(user.username),
                      }, activeAction === `unfollow:${user.username}` ? "Updating..." : "Unfollow"),
                      e("button", {
                        className: "button secondary",
                        type: "button",
                        disabled: activeAction === `remove:${user.username}`,
                        onClick: () => removeFollower(user.username),
                      }, activeAction === `remove:${user.username}` ? "Removing..." : "Remove"),
                    ),
                  }))
              : e("p", { className: "empty-message" }, "No mutual friends yet. Follow back the people you like.")),
        ),
    ),
  );
}

function FriendsTabButton({ active, label, onClick }) {
  return e(
    "button",
    {
      className: `friends-tab ${active ? "active" : ""}`,
      type: "button",
      onClick,
    },
    label,
  );
}

function SocialSummaryCard({ label, value }) {
  return e(
    "article",
    { className: "friends-summary-card" },
    e("p", null, label),
    e("strong", null, value),
  );
}

function SocialUserCard({ user, actionArea }) {
  return e(
    "div",
    { className: "social-user-card" },
    e(
      "div",
      { className: "social-user-copy" },
      e("strong", null, user.displayName),
      e("p", { className: "username" }, `@${user.username}`),
      e("p", { className: "social-user-meta" }, socialUserMeta(user)),
      e(
        "div",
        { className: "social-badges" },
        relationshipBadgeText(user).map((badge) =>
          e("span", { key: badge, className: "social-badge" }, badge),
        ),
      ),
    ),
    actionArea,
  );
}

function FeedPosterCard({ entry }) {
  return e(
    "article",
    { className: "feed-card poster-card" },
    e(
      "div",
      { className: "poster-art", style: posterArtStyle(entry) },
      e("span", { className: "poster-kicker" }, entry.cuisine || entry.suburb || "Friend activity"),
      e("h3", { className: "poster-title" }, entry.dish),
      e("p", { className: "poster-subtitle" }, entry.restaurant),
      e("span", { className: "poster-score" }, `${formatRating(entry.rating)}/10`),
    ),
    e(
      "div",
      { className: "poster-body" },
      e(
        "div",
        { className: "poster-meta-row" },
        e(
          "div",
          null,
          e("p", { className: "card-username" }, `@${entry.username}`),
          e("p", { className: "feed-timestamp" }, formatSocialDate(entry.createdAt)),
        ),
        e("div", { className: "star-row", "aria-hidden": "true" }, ratingStars(entry.rating)),
      ),
      e(
        "div",
        { className: "entry-meta feed-meta" },
        e("span", { className: "meta-item" }, visibilityLabel(entry.visibility)),
        entry.price !== null &&
          entry.price !== undefined &&
          e("span", { className: "meta-item" }, formatMoney(entry.price)),
      ),
      entry.comments && e("p", { className: "entry-comments" }, entry.comments),
    ),
  );
}

function discoverActionArea({ user, activeAction, onFollow, onAccept }) {
  if (user.isFriend) {
    return e("button", { className: "button secondary", type: "button", disabled: true }, "Friends");
  }
  if (user.hasIncomingRequest) {
    return e("button", {
      className: "button",
      type: "button",
      disabled: activeAction === `accept:${user.username}`,
      onClick: () => onAccept(user.username),
    }, activeAction === `accept:${user.username}` ? "Accepting..." : "Accept request");
  }
  if (user.followStatus === "accepted") {
    return e("button", { className: "button secondary", type: "button", disabled: true }, "Following");
  }
  if (user.followStatus === "pending") {
    return e("button", { className: "button secondary", type: "button", disabled: true }, "Pending");
  }
  return e("button", {
    className: "button",
    type: "button",
    disabled: activeAction === `follow:${user.username}`,
    onClick: () => onFollow(user.username),
  }, activeAction === `follow:${user.username}` ? "Following..." : "Follow");
}

function socialCountsFromUser(user) {
  return {
    followersCount: user?.followersCount || 0,
    followingCount: user?.followingCount || 0,
    friendsCount: user?.friendsCount || 0,
    pendingCount: user?.pendingCount || 0,
  };
}

function socialUserMeta(user) {
  const parts = [];
  if (Number.isFinite(user.entriesCount)) {
    parts.push(`${user.entriesCount} public ${user.entriesCount === 1 ? "entry" : "entries"}`);
  }
  if (Number.isFinite(user.followersCount)) {
    parts.push(`${user.followersCount} ${user.followersCount === 1 ? "follower" : "followers"}`);
  }
  if (Number.isFinite(user.friendsCount)) {
    parts.push(`${user.friendsCount} ${user.friendsCount === 1 ? "friend" : "friends"}`);
  }
  if (user.connectedAt) {
    parts.push(`Connected ${formatSocialDate(user.connectedAt)}`);
  } else if (user.createdAt) {
    parts.push(`Joined ${formatSocialDate(user.createdAt)}`);
  }
  return parts.join(" • ") || "Food diary member";
}

function relationshipBadgeText(user) {
  const badges = [];
  if (user.isFriend) {
    badges.push("Friends");
  } else {
    if (user.followsYou) {
      badges.push("Follows you");
    }
    if (user.followStatus === "accepted") {
      badges.push("Following");
    }
    if (user.followStatus === "pending") {
      badges.push("Pending");
    }
    if (user.hasIncomingRequest) {
      badges.push("Requested you");
    }
  }
  return badges;
}

function Datalist({ id, options }) {
  return e(
    "datalist",
    { id },
    options.map((option) => e("option", { key: option, value: option })),
  );
}

function screenCopy(appTab, user, stats) {
  const firstName = String(user?.displayName || "there").trim().split(/\s+/, 1)[0] || "there";
  if (appTab === "home") {
    return {
      eyebrow: "Home",
      title: `Welcome back, ${firstName}.`,
      copy: "A cleaner, content-first home for your latest meals, best spots, and food streaks.",
      metrics: [
        { label: "Logged", value: stats?.dishCount || 0 },
        { label: "Top", value: stats?.topCuisine?.label || "Still exploring" },
        { label: "Mood", value: stats?.moodLabel || "Fresh start" },
      ],
    };
  }
  if (appTab === "food") {
    return {
      eyebrow: "Food",
      title: "Everything you’ve logged.",
      copy: "Search, sort, and scan every dish in a single poster-style library.",
      metrics: [
        { label: "Logged", value: stats?.dishCount || 0 },
        { label: "Avg", value: `${formatRating(stats?.averageRating || 0)}/10` },
        { label: "Buy again", value: `${Math.round((stats?.buyAgainRate || 0) * 100)}%` },
      ],
    };
  }
  if (appTab === "restaurants") {
    return {
      eyebrow: "Restaurants",
      title: "Your regular spots and one-offs.",
      copy: "A quick read on the places you keep going back to and how they’re rating overall.",
      metrics: [
        { label: "Places", value: stats?.restaurantCount || 0 },
        { label: "Repeats", value: stats?.repeatRestaurantCount || 0 },
        { label: "Best", value: stats?.topRestaurant?.label || "--" },
      ],
    };
  }
  if (appTab === "add") {
    return {
      eyebrow: "Add",
      title: "Capture the next great bite.",
      copy: "Log the dish, the place, the score, and the note while it still feels fresh.",
      metrics: [
        { label: "Logged", value: stats?.dishCount || 0 },
        { label: "Avg", value: `${formatRating(stats?.averageRating || 0)}/10` },
      ],
    };
  }
  if (appTab === "friends") {
    return {
      eyebrow: "New from friends",
      title: `Your circle, ${firstName}.`,
      copy: "A premium social layer for follows, mutuals, and the latest dishes worth watching.",
      metrics: [
        { label: "Followers", value: user?.followersCount || 0 },
        { label: "Following", value: user?.followingCount || 0 },
        { label: "Friends", value: user?.friendsCount || 0 },
      ],
    };
  }
  if (appTab === "stats") {
    return {
      eyebrow: "Stats",
      title: "A sharper read on your taste.",
      copy: "See the places, cuisines, and streaks that define your best food runs.",
      metrics: [
        { label: "Logged", value: stats?.dishCount || 0 },
        { label: "Spent", value: stats?.pricedCount ? formatMoney(stats.totalSpent) : "--" },
      ],
    };
  }
  return {
    eyebrow: "Home",
    title: `Welcome back, ${firstName}.`,
    copy: "A cleaner, poster-first view of your diary so the food stays the focus.",
    metrics: [
      { label: "Logged", value: stats?.dishCount || 0 },
      { label: "Top", value: stats?.topCuisine?.label || "Still exploring" },
      { label: "Mood", value: stats?.moodLabel || "Fresh start" },
    ],
  };
}

function initialsFromName(value) {
  const parts = String(value || "")
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2);
  if (!parts.length) {
    return "VD";
  }
  return parts.map((part) => part[0].toUpperCase()).join("");
}

function ratingStars(value) {
  const filled = Math.max(1, Math.min(5, Math.round((Number(value) || 0) / 2)));
  return Array.from({ length: 5 }, (_, index) =>
    e(
      "span",
      {
        key: index,
        className: `star ${index < filled ? "filled" : ""}`,
      },
      "★",
    ),
  );
}

function posterArtStyle(entry) {
  const seed = hashText([
    entry.dish,
    entry.restaurant,
    entry.cuisine,
    entry.username,
  ].join("|"));
  const hueA = seed % 360;
  const hueB = (seed * 7) % 360;
  const hueC = (seed * 13) % 360;
  return {
    background: [
      `linear-gradient(180deg, rgba(6, 10, 16, 0.1), rgba(6, 10, 16, 0.78))`,
      `radial-gradient(circle at top left, hsla(${hueA}, 72%, 58%, 0.34), transparent 52%)`,
      `radial-gradient(circle at top right, hsla(${hueB}, 68%, 52%, 0.22), transparent 48%)`,
      `linear-gradient(145deg, hsla(${hueC}, 46%, 18%, 0.95), rgba(11, 15, 23, 0.98))`,
    ].join(", "),
  };
}

function hashText(value) {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) >>> 0;
  }
  return hash;
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

function formatSocialDate(value) {
  if (!value) {
    return "";
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "";
  }

  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(date);
}

function visibilityLabel(value) {
  if (value === "friends_only") {
    return "Friends only";
  }
  if (value === "public") {
    return "Public";
  }
  return "Private";
}

function sortFoodEntries(entries, sortMode) {
  const sorted = [...entries];
  sorted.sort((first, second) => {
    if (sortMode === "rating_desc") {
      return (Number(second.rating) || 0) - (Number(first.rating) || 0) || compareNewest(first, second);
    }
    if (sortMode === "rating_asc") {
      return (Number(first.rating) || 0) - (Number(second.rating) || 0) || compareNewest(first, second);
    }
    if (sortMode === "restaurant_az") {
      return compareText(first.restaurant, second.restaurant) || compareNewest(first, second);
    }
    if (sortMode === "dish_az") {
      return compareText(first.dish, second.dish) || compareNewest(first, second);
    }
    if (sortMode === "price_desc") {
      return (Number(second.price) || 0) - (Number(first.price) || 0) || compareNewest(first, second);
    }
    return compareNewest(first, second);
  });
  return sorted;
}

function compareNewest(first, second) {
  const firstTime = sortableTime(first);
  const secondTime = sortableTime(second);
  return secondTime - firstTime;
}

function sortableTime(entry) {
  const createdAt = Date.parse(entry?.createdAt || "");
  if (Number.isFinite(createdAt)) {
    return createdAt;
  }
  const updatedAt = Date.parse(entry?.updatedAt || "");
  if (Number.isFinite(updatedAt)) {
    return updatedAt;
  }
  return Number(entry?.id) || 0;
}

function compareText(first, second) {
  return String(first || "").localeCompare(String(second || ""), undefined, { sensitivity: "base" });
}

function buildRestaurantDirectory(entries) {
  const restaurants = new Map();

  entries.forEach((entry) => {
    const name = String(entry.restaurant || "").trim();
    if (!name) {
      return;
    }

    const key = name.toLowerCase();
    const current = restaurants.get(key) || {
      key,
      name,
      visits: 0,
      totalRating: 0,
      latestDate: "",
      latestDish: "",
      suburb: "",
      primaryCuisine: "",
      buyAgainCount: 0,
      cuisineCounts: new Map(),
    };

    current.visits += 1;
    current.totalRating += Number(entry.rating) || 0;
    if (entry.wouldBuyAgain) {
      current.buyAgainCount += 1;
    }

    const cuisine = String(entry.cuisine || "").trim();
    if (cuisine) {
      current.cuisineCounts.set(cuisine, (current.cuisineCounts.get(cuisine) || 0) + 1);
    }

    const currentTime = sortableTime(entry);
    const knownTime = current.latestDate ? sortableTime({ createdAt: current.latestDate }) : -1;
    if (currentTime >= knownTime) {
      current.latestDate = entry.createdAt || entry.updatedAt || current.latestDate;
      current.latestDish = entry.dish || current.latestDish;
      current.suburb = entry.suburb || current.suburb;
    }

    restaurants.set(key, current);
  });

  return Array.from(restaurants.values())
    .map((restaurant) => {
      const cuisines = Array.from(restaurant.cuisineCounts.entries()).sort(
        (first, second) => second[1] - first[1] || first[0].localeCompare(second[0]),
      );
      const primaryCuisine = cuisines[0]?.[0] || "";
      return {
        key: restaurant.key,
        name: restaurant.name,
        visits: restaurant.visits,
        averageRating: restaurant.visits ? restaurant.totalRating / restaurant.visits : 0,
        latestDate: restaurant.latestDate,
        latestDish: restaurant.latestDish,
        suburb: restaurant.suburb,
        primaryCuisine,
        buyAgainRate: restaurant.visits ? restaurant.buyAgainCount / restaurant.visits : 0,
        note: buildRestaurantNote(restaurant.visits, primaryCuisine, restaurant.latestDish),
      };
    })
    .sort(
      (first, second) =>
        second.visits - first.visits ||
        second.averageRating - first.averageRating ||
        first.name.localeCompare(second.name),
    );
}

function buildRestaurantNote(visits, cuisine, latestDish) {
  const parts = [];
  if (visits > 1) {
    parts.push(`${visits} logged visits`);
  } else {
    parts.push("1 logged visit");
  }
  if (cuisine) {
    parts.push(`${cuisine} spot`);
  }
  if (latestDish) {
    parts.push(`last dish: ${latestDish}`);
  }
  return parts.join(" • ");
}

function buildStats(entries) {
  const dishCount = entries.length;
  const restaurantCounts = new Map();
  const restaurantLabels = new Map();
  const suburbCounts = new Map();
  const suburbLabels = new Map();
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

    const suburbLabel = String(entry.suburb || "").trim();
    const suburbKey = suburbLabel.toLowerCase();
    if (suburbKey) {
      suburbLabels.set(suburbKey, suburbLabels.get(suburbKey) || suburbLabel);
      incrementCount(suburbCounts, suburbKey);
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
  const suburbBreakdown = rankedCounts(suburbCounts, suburbLabels);
  const cuisineBreakdown = rankedCounts(cuisineCounts, cuisineLabels);
  const spendByCuisine = rankedMoney(cuisineSpend, cuisineLabels);
  const repeatRestaurantCount = restaurantBreakdown.filter((item) => item.count > 1).length;

  return {
    dishCount,
    restaurantCount: restaurantCounts.size,
    uniqueSuburbs: suburbCounts.size,
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
    topSuburb: suburbBreakdown[0] || null,
    bestEntry,
    spendiestEntry,
    bestValueEntry,
    cuisineBreakdown: cuisineBreakdown.slice(0, 6),
    restaurantBreakdown: restaurantBreakdown.slice(0, 6),
    suburbBreakdown: suburbBreakdown.slice(0, 6),
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

function buildSuggestionLists(entries) {
  return {
    restaurants: uniqueOptions(entries.map((entry) => entry.restaurant)),
    suburbs: uniqueOptions(entries.map((entry) => entry.suburb)),
    dishes: uniqueOptions(entries.map((entry) => entry.dish)),
    cuisines: uniqueOptions([
      ...COMMON_CUISINES,
      ...entries.map((entry) => entry.cuisine),
    ]),
  };
}

function uniqueOptions(values) {
  const seen = new Set();
  return values
    .map((value) => String(value || "").trim())
    .filter((value) => {
      if (!value) {
        return false;
      }
      const key = value.toLowerCase();
      if (seen.has(key)) {
        return false;
      }
      seen.add(key);
      return true;
    })
    .sort((first, second) => first.localeCompare(second));
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
