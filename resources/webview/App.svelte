<script lang="ts">
  import { appState } from "./lib/state.svelte";
  import TabBar from "./components/TabBar.svelte";
  import ChatPage from "./components/ChatPage.svelte";
  import PresetPage from "./components/PresetPage.svelte";
  import ProfilePage from "./components/ProfilePage.svelte";
  import ToastNotification from "./components/ToastNotification.svelte";
</script>

<div class="app">
  <TabBar />

  {#if appState.currentTab === "chat"}
    <ChatPage />
  {:else if appState.currentTab === "presets"}
    <PresetPage />
  {:else if appState.currentTab === "profiles"}
    <ProfilePage />
  {/if}

  <ToastNotification />
</div>

<style>
  .app {
    flex: 1;
    display: flex;
    flex-direction: column;
    overflow: hidden;
    min-height: 0;
  }
</style>
