<script lang="ts">
  import SessionBar from "./SessionBar.svelte";
  import MessageBoard from "./MessageBoard.svelte";
  import Composer from "./Composer.svelte";
  import ModifiedFiles from "./ModifiedFiles.svelte";
</script>

<div class="chat-page">
  <SessionBar />
  <MessageBoard />
  <ModifiedFiles />
  <Composer />
</div>

<style>
  .chat-page {
    flex: 1;
    display: flex;
    flex-direction: column;
    overflow: hidden;
    min-height: 0;
  }
</style>
