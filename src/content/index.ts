import "../shared/settings";
import "../domain/formatter";
import "../extractor";
import "../selection";
import "../chatgpt";
import "./clipboard";
import "./toast";
import "./floating-button";
import "../content";
import { initChatGptLinkCleanup } from "../link-cleanup";

initChatGptLinkCleanup(document, location.hostname);
