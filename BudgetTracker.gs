// =============================================
// COOKIE BUDGET BOT v2.0 - Enhanced Features
// =============================================
// New Features:
// 1. Fixed voice mode query support
// 2. Add/delete payment sources from chat
// 3. Delete previous transactions
// 4. Add/delete categories and manage budgets
// 5. Credit card tracking with monthly statements
// =============================================

// --- CONFIGURATION (loaded from Script Properties) ---
const props = PropertiesService.getScriptProperties();
const TELEGRAM_TOKEN = props.getProperty("TELEGRAM_TOKEN");
const GEMINI_API_KEY = props.getProperty("GEMINI_API_KEY");
const ADMIN_CHAT_ID = props.getProperty("ADMIN_CHAT_ID");
const WEBAPP_URL = props.getProperty("WEBAPP_URL");
const SPREADSHEET_ID = props.getProperty("SPREADSHEET_ID");

// --- DEFAULT CATEGORIES (can be extended via chat) ---
const DEFAULT_CATEGORIES = [
  "Food", "Coffee", "Transport", "Subscriptions", "Entertainment",
  "Shopping", "Health", "Utilities", "Rent", "Education", "Top-up",
  "Salary", "Freelance", "Gift", "Gadgets", "Groceries", "Other",
  "Investment", "Credit Payment"
];

// --- Get dynamic categories from sheet ---
function getCategories() {
  const customCategories = getCustomCategories();
  return [...new Set([...DEFAULT_CATEGORIES, ...customCategories])];
}

function getCustomCategories() {
  try {
    const btSheet = SpreadsheetApp.openById(SPREADSHEET_ID).getSheetByName("BudgetTracker");
    if (!btSheet) return [];
    
    const data = btSheet.getDataRange().getValues();
    let inCategoriesTable = false;
    const categories = [];
    
    for (let i = 0; i < data.length; i++) {
      const firstCell = String(data[i][0]).trim();
      
      if (firstCell === "Custom Categories") {
        inCategoriesTable = true;
        continue;
      }
      
      if (inCategoriesTable && firstCell === "Category") continue;
      if (inCategoriesTable && !firstCell) break;
      
      if (inCategoriesTable && firstCell) {
        categories.push(firstCell);
      }
    }
    
    return categories;
  } catch (e) {
    console.error("getCustomCategories error: " + e);
    return [];
  }
}

// --- Get valid sources from BudgetTracker sheet ---
function getValidSources() {
  try {
    const btSheet = SpreadsheetApp.openById(SPREADSHEET_ID).getSheetByName("BudgetTracker");
    if (!btSheet) return ["BCA", "GoPay", "ShopeePay", "Cash (IDR)", "DBS", "CommBank", "Cash (TWD)"];
    
    const data = btSheet.getDataRange().getValues();
    let inSourceTable = false;
    const sources = [];
    
    for (let i = 0; i < data.length; i++) {
      const firstCell = String(data[i][0]).trim();
      
      if (firstCell === "Source") {
        inSourceTable = true;
        continue;
      }
      
      if (firstCell === "Limits" || firstCell === "Custom Categories" || firstCell === "Credit Card" || (inSourceTable && !firstCell)) {
        break;
      }
      
      if (firstCell === "Method") continue;
      
      if (inSourceTable && firstCell) {
        sources.push(firstCell);
      }
    }
    
    return sources.length > 0 ? sources : ["BCA", "GoPay", "ShopeePay", "Cash (IDR)", "DBS", "CommBank", "Cash (TWD)"];
  } catch (e) {
    console.error("getValidSources error: " + e);
    return ["BCA", "GoPay", "ShopeePay", "Cash (IDR)", "DBS", "CommBank", "Cash (TWD)"];
  }
}

const DEFAULT_SOURCE = "BCA";

// --- MODEL CONFIG ---
const MODEL = "gemini-2.5-flash-lite";

// --- CONVERSATION STATE (stored in Script Properties) ---
function getConversationState(chatId) {
  const key = `STATE_${chatId}`;
  const state = props.getProperty(key);
  return state ? JSON.parse(state) : null;
}

function setConversationState(chatId, state) {
  const key = `STATE_${chatId}`;
  if (state) {
    props.setProperty(key, JSON.stringify(state));
  } else {
    props.deleteProperty(key);
  }
}

// =============================================
// --- WEBHOOK HANDLER (instant replies) ---
// =============================================
function doPost(e) {
  try {
    const update = JSON.parse(e.postData.contents);

    const lastUpdateId = props.getProperty("LAST_UPDATE_ID");
    const currentUpdateId = update.update_id.toString();
    if (lastUpdateId === currentUpdateId) {
      return ContentService.createTextOutput("OK");
    }
    props.setProperty("LAST_UPDATE_ID", currentUpdateId);
    props.setProperty("SWEEP_OFFSET", (update.update_id + 1).toString());

    if (!update.message) {
      return ContentService.createTextOutput("OK");
    }

    const chatId = update.message.chat.id;

    if (chatId.toString() !== ADMIN_CHAT_ID.toString()) {
      sendMessage(chatId, "Sorry, I don't know you! Cookie only works for the boss.");
      return ContentService.createTextOutput("OK");
    }

    // Check for pending conversation state first
    const state = getConversationState(chatId);
    if (state && update.message.text) {
      handleStatefulResponse(chatId, update.message.text, state);
      return ContentService.createTextOutput("OK");
    }

    if (update.message.text === "/start") {
      sendMessage(chatId, "Hey there! Cookie is awake and ready. Tell me what you spent, earned, or ask me anything about your finances.\n\nNew commands:\n- Add/delete sources (e.g., 'add source BCA Credit Card')\n- Delete transactions (e.g., 'delete last transaction')\n- Add/delete categories (e.g., 'add category Travel')\n- Manage budgets (e.g., 'set Food budget to 2jt')\n- Credit card tracking (use 'Credit' as source)");
    } else if (update.message.voice) {
      handleMediaMessage(chatId, update.message.voice.file_id, "audio/ogg");
    } else if (update.message.video_note) {
      handleMediaMessage(chatId, update.message.video_note.file_id, "video/mp4");
    } else if (update.message.video) {
      handleMediaMessage(chatId, update.message.video.file_id, update.message.video.mime_type || "video/mp4");
    } else if (update.message.text) {
      routeMessage(chatId, update.message.text);
    }

  } catch (error) {
    console.error("doPost error: " + error);
  }

  return ContentService.createTextOutput("OK");
}

// =============================================
// --- STATEFUL CONVERSATION HANDLER ---
// =============================================
function handleStatefulResponse(chatId, text, state) {
  switch (state.action) {
    case "add_source_amount":
      handleAddSourceAmount(chatId, text, state);
      break;
    case "confirm_delete_transaction":
      handleConfirmDeleteTransaction(chatId, text, state);
      break;
    case "select_transaction_to_delete":
      handleSelectTransactionToDelete(chatId, text, state);
      break;
    case "set_budget_amount":
      handleSetBudgetAmount(chatId, text, state);
      break;
    default:
      setConversationState(chatId, null);
      routeMessage(chatId, text);
  }
}

// =============================================
// --- SWEEP PENDING (trigger: every 1 minute) ---
// =============================================
function sweepPending() {
  const deleteUrl = `https://api.telegram.org/bot${TELEGRAM_TOKEN}/deleteWebhook`;
  UrlFetchApp.fetch(deleteUrl, { muteHttpExceptions: true });

  try {
    const offset = props.getProperty("SWEEP_OFFSET") || "0";
    const pollUrl = `https://api.telegram.org/bot${TELEGRAM_TOKEN}/getUpdates?offset=${offset}&timeout=0`;
    const pollResponse = UrlFetchApp.fetch(pollUrl, { muteHttpExceptions: true });
    const pollData = JSON.parse(pollResponse.getContentText());

    if (pollData.ok && pollData.result && pollData.result.length > 0) {
      const lastUpdateId = props.getProperty("LAST_UPDATE_ID");

      for (const update of pollData.result) {
        if (update.update_id.toString() === lastUpdateId) {
          props.setProperty("SWEEP_OFFSET", (update.update_id + 1).toString());
          continue;
        }

        try {
          if (update.message) {
            const chatId = update.message.chat.id;

            if (chatId.toString() !== ADMIN_CHAT_ID.toString()) {
              sendMessage(chatId, "Sorry, I don't know you! Cookie only works for the boss.");
            } else {
              const state = getConversationState(chatId);
              if (state && update.message.text) {
                handleStatefulResponse(chatId, update.message.text, state);
              } else if (update.message.text === "/start") {
                sendMessage(chatId, "Hey there! Cookie is awake and ready.");
              } else if (update.message.voice) {
                handleMediaMessage(chatId, update.message.voice.file_id, "audio/ogg");
              } else if (update.message.video_note) {
                handleMediaMessage(chatId, update.message.video_note.file_id, "video/mp4");
              } else if (update.message.video) {
                handleMediaMessage(chatId, update.message.video.file_id, update.message.video.mime_type || "video/mp4");
              } else if (update.message.text) {
                routeMessage(chatId, update.message.text);
              }
            }
          }
        } catch (e) {
          console.error("Sweep processing error for update " + update.update_id + ": " + e);
        }

        props.setProperty("LAST_UPDATE_ID", update.update_id.toString());
        props.setProperty("SWEEP_OFFSET", (update.update_id + 1).toString());
      }
    }
  } catch (e) {
    console.error("Sweep poll error: " + e);
  }

  const setUrl = `https://api.telegram.org/bot${TELEGRAM_TOKEN}/setWebhook?url=${WEBAPP_URL}`;
  UrlFetchApp.fetch(setUrl, { muteHttpExceptions: true });
}

// =============================================
// --- ROUTER (Enhanced with management commands) ---
// =============================================
function routeMessage(chatId, text) {
  const intent = classifyIntent(text);

  switch (intent.type) {
    case "query":
      handleQuery(chatId, text);
      break;
    case "add_source":
      handleAddSource(chatId, intent.sourceName);
      break;
    case "delete_source":
      handleDeleteSource(chatId, intent.sourceName);
      break;
    case "add_category":
      handleAddCategory(chatId, intent.categoryName);
      break;
    case "delete_category":
      handleDeleteCategory(chatId, intent.categoryName);
      break;
    case "delete_transaction":
      handleDeleteTransaction(chatId, intent.criteria);
      break;
    case "set_budget":
      handleSetBudget(chatId, intent.category, intent.amount);
      break;
    case "delete_budget":
      handleDeleteBudget(chatId, intent.category);
      break;
    case "show_credit":
      handleShowCredit(chatId);
      break;
    case "log":
    default:
      processFinancialMessage(chatId, text);
  }
}

function classifyIntent(text) {
  const CATEGORIES = getCategories();
  const VALID_SOURCES = getValidSources();
  
  const prompt = `
    Classify this message into exactly one intent.
    Message: "${text}"

    Intents:
    - "log": Recording a financial transaction (spent, earned, bought, paid, received, transferred, moved funds, credit payment, etc.)
    - "query": Asking a question about finances, requesting a summary, or asking for analysis
    - "add_source": Adding a new payment source/method (e.g., "add source BCA Credit Card", "add BCA Credit as a payment method")
    - "delete_source": Removing a payment source (e.g., "delete source GoPay", "remove BCA Credit Card source")
    - "add_category": Adding a new spending category (e.g., "add category Travel", "create new category Pets")
    - "delete_category": Removing a category (e.g., "delete category Travel", "remove Pets category")
    - "delete_transaction": Deleting a previous transaction (e.g., "delete last transaction", "remove the coffee expense from yesterday", "undo last log")
    - "set_budget": Setting or updating a monthly budget limit (e.g., "set Food budget to 2jt", "change Coffee budget to 500k")
    - "delete_budget": Removing a budget limit (e.g., "delete Food budget", "remove budget for Coffee")
    - "show_credit": Asking about credit card balance/due (e.g., "how much do I owe on credit", "show credit card balance")

    Current categories: ${CATEGORIES.join(", ")}
    Current sources: ${VALID_SOURCES.join(", ")}

    Transfers like "transferred 10k from BCA to GoPay" are always "log".
    "Credit payment 500k" or "paid credit card bill" are "log" (they're transactions).

    Return a JSON object based on intent:
    - log: { "type": "log" }
    - query: { "type": "query" }
    - add_source: { "type": "add_source", "sourceName": "extracted source name" }
    - delete_source: { "type": "delete_source", "sourceName": "extracted source name" }
    - add_category: { "type": "add_category", "categoryName": "extracted category name" }
    - delete_category: { "type": "delete_category", "categoryName": "extracted category name" }
    - delete_transaction: { "type": "delete_transaction", "criteria": "last" or "description of which one" }
    - set_budget: { "type": "set_budget", "category": "category name", "amount": number or null if not specified }
    - delete_budget: { "type": "delete_budget", "category": "category name" }
    - show_credit: { "type": "show_credit" }
  `;

  const result = callGemini(prompt, true);
  if (result.error) return { type: "log" };

  try {
    const parsed = JSON.parse(result.text);
    return parsed.type ? parsed : { type: "log" };
  } catch (e) {
    return { type: "log" };
  }
}

// =============================================
// --- SOURCE MANAGEMENT ---
// =============================================
function handleAddSource(chatId, sourceName) {
  if (!sourceName || sourceName.trim() === "") {
    sendMessage(chatId, "What source would you like to add? Give me a name like 'BCA Credit Card' or 'PayPal'.");
    return;
  }
  
  const VALID_SOURCES = getValidSources();
  const normalizedName = sourceName.trim();
  
  // Check if already exists
  for (const vs of VALID_SOURCES) {
    if (vs.toLowerCase() === normalizedName.toLowerCase()) {
      sendMessage(chatId, `${vs} already exists as a payment source.`);
      return;
    }
  }
  
  // Set state to wait for starting amount
  setConversationState(chatId, {
    action: "add_source_amount",
    sourceName: normalizedName
  });
  
  sendMessage(chatId, `Got it! Adding "${normalizedName}" as a new source. What's the starting balance? (Enter 0 if empty, or the current balance like "500k" or "1.5jt")`);
}

function handleAddSourceAmount(chatId, text, state) {
  const amount = parseAmount(text);
  const sourceName = state.sourceName;
  
  try {
    const btSheet = SpreadsheetApp.openById(SPREADSHEET_ID).getSheetByName("BudgetTracker");
    if (!btSheet) {
      sendMessage(chatId, "Couldn't find the BudgetTracker sheet. Something's wrong with the setup.");
      setConversationState(chatId, null);
      return;
    }
    
    const data = btSheet.getDataRange().getValues();
    let insertRow = -1;
    let inSourceTable = false;
    
    for (let i = 0; i < data.length; i++) {
      const firstCell = String(data[i][0]).trim();
      
      if (firstCell === "Source") {
        inSourceTable = true;
        continue;
      }
      
      if (inSourceTable && (firstCell === "Limits" || firstCell === "Custom Categories" || firstCell === "Credit Card" || !firstCell)) {
        insertRow = i + 1; // Insert before this row
        break;
      }
    }
    
    if (insertRow === -1) {
      // If we didn't find a good spot, add after the last source row
      insertRow = data.length + 1;
    }
    
    // Insert new row
    btSheet.insertRowBefore(insertRow);
    btSheet.getRange(insertRow, 1).setValue(sourceName);
    btSheet.getRange(insertRow, 2).setValue(amount);
    btSheet.getRange(insertRow, 3).setValue("Added via Cookie");
    
    sendMessage(chatId, `Added "${sourceName}" with starting balance of ${formatNumber(amount)}. You can now use it as a payment source!`);
    
  } catch (e) {
    console.error("handleAddSourceAmount error: " + e);
    sendMessage(chatId, "Something went wrong adding the source. Try again?");
  }
  
  setConversationState(chatId, null);
}

function handleDeleteSource(chatId, sourceName) {
  if (!sourceName || sourceName.trim() === "") {
    sendMessage(chatId, "Which source do you want to delete?");
    return;
  }
  
  const VALID_SOURCES = getValidSources();
  let matchedSource = null;
  
  for (const vs of VALID_SOURCES) {
    if (vs.toLowerCase() === sourceName.toLowerCase() || 
        vs.toLowerCase().includes(sourceName.toLowerCase())) {
      matchedSource = vs;
      break;
    }
  }
  
  if (!matchedSource) {
    sendMessage(chatId, `Couldn't find a source matching "${sourceName}". Current sources: ${VALID_SOURCES.join(", ")}`);
    return;
  }
  
  try {
    const btSheet = SpreadsheetApp.openById(SPREADSHEET_ID).getSheetByName("BudgetTracker");
    const data = btSheet.getDataRange().getValues();
    let inSourceTable = false;
    
    for (let i = 0; i < data.length; i++) {
      const firstCell = String(data[i][0]).trim();
      
      if (firstCell === "Source") {
        inSourceTable = true;
        continue;
      }
      
      if (inSourceTable && (firstCell === "Limits" || firstCell === "Custom Categories" || firstCell === "Credit Card" || !firstCell)) {
        break;
      }
      
      if (inSourceTable && firstCell === matchedSource) {
        btSheet.deleteRow(i + 1);
        sendMessage(chatId, `Deleted "${matchedSource}" from your payment sources.`);
        return;
      }
    }
    
    sendMessage(chatId, `Couldn't find "${matchedSource}" in the sheet to delete.`);
    
  } catch (e) {
    console.error("handleDeleteSource error: " + e);
    sendMessage(chatId, "Something went wrong deleting the source. Try again?");
  }
}

// =============================================
// --- CATEGORY MANAGEMENT ---
// =============================================
function handleAddCategory(chatId, categoryName) {
  if (!categoryName || categoryName.trim() === "") {
    sendMessage(chatId, "What category would you like to add?");
    return;
  }
  
  const CATEGORIES = getCategories();
  const normalizedName = categoryName.trim();
  
  // Check if already exists
  for (const cat of CATEGORIES) {
    if (cat.toLowerCase() === normalizedName.toLowerCase()) {
      sendMessage(chatId, `${cat} already exists as a category.`);
      return;
    }
  }
  
  try {
    const btSheet = SpreadsheetApp.openById(SPREADSHEET_ID).getSheetByName("BudgetTracker");
    const data = btSheet.getDataRange().getValues();
    
    // Find or create Custom Categories section
    let customCategoriesStart = -1;
    let insertRow = -1;
    
    for (let i = 0; i < data.length; i++) {
      const firstCell = String(data[i][0]).trim();
      
      if (firstCell === "Custom Categories") {
        customCategoriesStart = i;
        continue;
      }
      
      if (customCategoriesStart !== -1 && firstCell === "Category") continue;
      
      if (customCategoriesStart !== -1 && !firstCell) {
        insertRow = i + 1;
        break;
      }
    }
    
    // If Custom Categories section doesn't exist, create it
    if (customCategoriesStart === -1) {
      const lastRow = btSheet.getLastRow();
      btSheet.getRange(lastRow + 2, 1).setValue("Custom Categories");
      btSheet.getRange(lastRow + 3, 1).setValue("Category");
      btSheet.getRange(lastRow + 3, 2).setValue("Description");
      insertRow = lastRow + 4;
    }
    
    if (insertRow === -1) {
      insertRow = btSheet.getLastRow() + 1;
    }
    
    btSheet.getRange(insertRow, 1).setValue(normalizedName);
    btSheet.getRange(insertRow, 2).setValue("Added via Cookie");
    
    sendMessage(chatId, `Added "${normalizedName}" as a new category. You can now use it when logging transactions!`);
    
  } catch (e) {
    console.error("handleAddCategory error: " + e);
    sendMessage(chatId, "Something went wrong adding the category. Try again?");
  }
}

function handleDeleteCategory(chatId, categoryName) {
  if (!categoryName || categoryName.trim() === "") {
    sendMessage(chatId, "Which category do you want to delete?");
    return;
  }
  
  // Check if it's a default category
  for (const cat of DEFAULT_CATEGORIES) {
    if (cat.toLowerCase() === categoryName.toLowerCase()) {
      sendMessage(chatId, `"${cat}" is a default category and can't be deleted. You can only delete custom categories you've added.`);
      return;
    }
  }
  
  try {
    const btSheet = SpreadsheetApp.openById(SPREADSHEET_ID).getSheetByName("BudgetTracker");
    const data = btSheet.getDataRange().getValues();
    let inCustomCategories = false;
    
    for (let i = 0; i < data.length; i++) {
      const firstCell = String(data[i][0]).trim();
      
      if (firstCell === "Custom Categories") {
        inCustomCategories = true;
        continue;
      }
      
      if (inCustomCategories && firstCell === "Category") continue;
      
      if (inCustomCategories && !firstCell) break;
      
      if (inCustomCategories && firstCell.toLowerCase() === categoryName.toLowerCase()) {
        btSheet.deleteRow(i + 1);
        sendMessage(chatId, `Deleted "${firstCell}" from your categories.`);
        return;
      }
    }
    
    sendMessage(chatId, `Couldn't find a custom category matching "${categoryName}".`);
    
  } catch (e) {
    console.error("handleDeleteCategory error: " + e);
    sendMessage(chatId, "Something went wrong deleting the category. Try again?");
  }
}

// =============================================
// --- BUDGET MANAGEMENT ---
// =============================================
function handleSetBudget(chatId, category, amount) {
  if (!category) {
    sendMessage(chatId, "Which category do you want to set a budget for?");
    return;
  }
  
  const CATEGORIES = getCategories();
  let matchedCategory = null;
  
  for (const cat of CATEGORIES) {
    if (cat.toLowerCase() === category.toLowerCase()) {
      matchedCategory = cat;
      break;
    }
  }
  
  if (!matchedCategory) {
    sendMessage(chatId, `"${category}" isn't a valid category. Current categories: ${CATEGORIES.join(", ")}`);
    return;
  }
  
  if (amount === null || amount === undefined) {
    setConversationState(chatId, {
      action: "set_budget_amount",
      category: matchedCategory
    });
    sendMessage(chatId, `What monthly budget do you want to set for ${matchedCategory}? (e.g., "500k", "1.5jt", "2000000")`);
    return;
  }
  
  updateBudgetLimit(chatId, matchedCategory, amount);
}

function handleSetBudgetAmount(chatId, text, state) {
  const amount = parseAmount(text);
  if (amount === 0 && !text.match(/^0$/)) {
    sendMessage(chatId, "Couldn't understand that amount. Try something like '500k' or '1.5jt'.");
    return;
  }
  
  updateBudgetLimit(chatId, state.category, amount);
  setConversationState(chatId, null);
}

function updateBudgetLimit(chatId, category, amount) {
  try {
    const btSheet = SpreadsheetApp.openById(SPREADSHEET_ID).getSheetByName("BudgetTracker");
    const data = btSheet.getDataRange().getValues();
    let inLimitsTable = false;
    let foundRow = -1;
    let limitsEndRow = -1;
    
    for (let i = 0; i < data.length; i++) {
      const firstCell = String(data[i][0]).trim();
      
      if (firstCell === "Limits") {
        inLimitsTable = true;
        continue;
      }
      
      if (inLimitsTable && firstCell === "Category") continue;
      
      if (inLimitsTable && (!firstCell || firstCell === "Custom Categories" || firstCell === "Credit Card")) {
        limitsEndRow = i + 1;
        break;
      }
      
      if (inLimitsTable && firstCell === category) {
        foundRow = i + 1;
        break;
      }
    }
    
    if (foundRow !== -1) {
      // Update existing
      btSheet.getRange(foundRow, 2).setValue(amount);
      sendMessage(chatId, `Updated ${category} budget to ${formatNumber(amount)} per month.`);
    } else {
      // Add new
      if (limitsEndRow === -1) limitsEndRow = btSheet.getLastRow() + 1;
      btSheet.insertRowBefore(limitsEndRow);
      btSheet.getRange(limitsEndRow, 1).setValue(category);
      btSheet.getRange(limitsEndRow, 2).setValue(amount);
      sendMessage(chatId, `Set ${category} budget to ${formatNumber(amount)} per month.`);
    }
    
  } catch (e) {
    console.error("updateBudgetLimit error: " + e);
    sendMessage(chatId, "Something went wrong updating the budget. Try again?");
  }
}

function handleDeleteBudget(chatId, category) {
  if (!category) {
    sendMessage(chatId, "Which category's budget do you want to delete?");
    return;
  }
  
  try {
    const btSheet = SpreadsheetApp.openById(SPREADSHEET_ID).getSheetByName("BudgetTracker");
    const data = btSheet.getDataRange().getValues();
    let inLimitsTable = false;
    
    for (let i = 0; i < data.length; i++) {
      const firstCell = String(data[i][0]).trim();
      
      if (firstCell === "Limits") {
        inLimitsTable = true;
        continue;
      }
      
      if (inLimitsTable && firstCell === "Category") continue;
      
      if (inLimitsTable && (!firstCell || firstCell === "Custom Categories" || firstCell === "Credit Card")) {
        break;
      }
      
      if (inLimitsTable && firstCell.toLowerCase() === category.toLowerCase()) {
        btSheet.deleteRow(i + 1);
        sendMessage(chatId, `Deleted the budget limit for ${firstCell}.`);
        return;
      }
    }
    
    sendMessage(chatId, `Couldn't find a budget for "${category}".`);
    
  } catch (e) {
    console.error("handleDeleteBudget error: " + e);
    sendMessage(chatId, "Something went wrong deleting the budget. Try again?");
  }
}

// =============================================
// --- TRANSACTION DELETION ---
// =============================================
function handleDeleteTransaction(chatId, criteria) {
  const sheet = SpreadsheetApp.openById(SPREADSHEET_ID).getSheetByName("RawBudget");
  const data = sheet.getDataRange().getValues();
  
  if (data.length <= 1) {
    sendMessage(chatId, "No transactions to delete yet!");
    return;
  }
  
  const rows = data.slice(1);
  
  if (criteria === "last" || criteria === "latest" || criteria === "most recent") {
    // Find the most recent transaction by date + time
    let mostRecent = { index: 0, timestamp: 0 };
    
    for (let i = 0; i < rows.length; i++) {
      const dateObj = parseDateStr(rows[i][0]);
      if (!dateObj) continue;
      
      const timeStr = String(rows[i][1] || "00:00:00");
      const timeParts = timeStr.split(":");
      dateObj.setHours(parseInt(timeParts[0]) || 0);
      dateObj.setMinutes(parseInt(timeParts[1]) || 0);
      dateObj.setSeconds(parseInt(timeParts[2]) || 0);
      
      if (dateObj.getTime() > mostRecent.timestamp) {
        mostRecent = { index: i, timestamp: dateObj.getTime() };
      }
    }
    
    const row = rows[mostRecent.index];
    const description = `${row[2]} of ${formatNumber(Number(String(row[4]).replace(/[^0-9]/g, "")))} for ${row[3]} on ${row[0]} (${row[6]})`;
    
    setConversationState(chatId, {
      action: "confirm_delete_transaction",
      rowIndex: mostRecent.index + 2 // +2 for header and 0-indexing
    });
    
    sendMessage(chatId, `Delete this transaction?\n${description}\n\nReply "yes" to confirm or "no" to cancel.`);
    return;
  }
  
  // Show recent transactions for selection
  const recentRows = rows.slice(0, Math.min(10, rows.length));
  let msg = "Which transaction do you want to delete? Reply with the number:\n\n";
  
  for (let i = 0; i < recentRows.length; i++) {
    const row = recentRows[i];
    const amount = Number(String(row[4]).replace(/[^0-9]/g, "")) || 0;
    msg += `${i + 1}. ${row[0]} - ${row[2]} ${formatNumber(amount)} for ${row[3]} (${row[6]})\n`;
  }
  
  setConversationState(chatId, {
    action: "select_transaction_to_delete",
    rows: recentRows.map((r, i) => ({ sheetRow: i + 2, data: r }))
  });
  
  sendMessage(chatId, msg);
}

function handleSelectTransactionToDelete(chatId, text, state) {
  const selection = parseInt(text);
  
  if (isNaN(selection) || selection < 1 || selection > state.rows.length) {
    sendMessage(chatId, `Please enter a number between 1 and ${state.rows.length}, or say "cancel".`);
    return;
  }
  
  if (text.toLowerCase() === "cancel") {
    setConversationState(chatId, null);
    sendMessage(chatId, "Cancelled.");
    return;
  }
  
  const selected = state.rows[selection - 1];
  const row = selected.data;
  const description = `${row[2]} of ${formatNumber(Number(String(row[4]).replace(/[^0-9]/g, "")))} for ${row[3]} on ${row[0]} (${row[6]})`;
  
  setConversationState(chatId, {
    action: "confirm_delete_transaction",
    rowIndex: selected.sheetRow
  });
  
  sendMessage(chatId, `Delete this transaction?\n${description}\n\nReply "yes" to confirm or "no" to cancel.`);
}

function handleConfirmDeleteTransaction(chatId, text, state) {
  const response = text.toLowerCase().trim();
  
  if (response === "yes" || response === "y" || response === "confirm") {
    try {
      const sheet = SpreadsheetApp.openById(SPREADSHEET_ID).getSheetByName("RawBudget");
      const row = sheet.getRange(state.rowIndex, 1, 1, 7).getValues()[0];
      
      // Reverse the source amount update
      const source = row[5];
      const type = row[2];
      const amount = Number(String(row[4]).replace(/[^0-9]/g, "")) || 0;
      
      if (source && amount > 0) {
        // Reverse: if it was an expense, add it back; if income, subtract it
        const reverseType = type === "Expense" ? "Income" : "Expense";
        updateSourceAmount(source, reverseType, amount);
        
        // Also handle credit card balance reversal
        if (source.toLowerCase().includes("credit")) {
          updateCreditBalance(reverseType === "Expense" ? -amount : amount);
        }
      }
      
      sheet.deleteRow(state.rowIndex);
      sendMessage(chatId, "Transaction deleted and balances adjusted.");
      
    } catch (e) {
      console.error("handleConfirmDeleteTransaction error: " + e);
      sendMessage(chatId, "Something went wrong deleting the transaction. Try again?");
    }
  } else {
    sendMessage(chatId, "Cancelled. Transaction not deleted.");
  }
  
  setConversationState(chatId, null);
}

// =============================================
// --- CREDIT CARD TRACKING ---
// =============================================
function getCreditCardBalance() {
  try {
    const btSheet = SpreadsheetApp.openById(SPREADSHEET_ID).getSheetByName("BudgetTracker");
    if (!btSheet) return 0;
    
    const data = btSheet.getDataRange().getValues();
    let inCreditSection = false;
    
    for (let i = 0; i < data.length; i++) {
      const firstCell = String(data[i][0]).trim();
      
      if (firstCell === "Credit Card") {
        inCreditSection = true;
        continue;
      }
      
      if (inCreditSection && firstCell === "Outstanding Balance") {
        const value = String(data[i][1]).replace(/[^0-9.\-]/g, "");
        return parseFloat(value) || 0;
      }
    }
    
    return 0;
  } catch (e) {
    console.error("getCreditCardBalance error: " + e);
    return 0;
  }
}

function updateCreditBalance(amount) {
  try {
    const btSheet = SpreadsheetApp.openById(SPREADSHEET_ID).getSheetByName("BudgetTracker");
    if (!btSheet) return;
    
    const data = btSheet.getDataRange().getValues();
    let creditSectionStart = -1;
    let balanceRow = -1;
    
    for (let i = 0; i < data.length; i++) {
      const firstCell = String(data[i][0]).trim();
      
      if (firstCell === "Credit Card") {
        creditSectionStart = i;
        continue;
      }
      
      if (creditSectionStart !== -1 && firstCell === "Outstanding Balance") {
        balanceRow = i + 1;
        break;
      }
    }
    
    // Create Credit Card section if it doesn't exist
    if (creditSectionStart === -1) {
      const lastRow = btSheet.getLastRow();
      btSheet.getRange(lastRow + 2, 1).setValue("Credit Card");
      btSheet.getRange(lastRow + 3, 1).setValue("Outstanding Balance");
      btSheet.getRange(lastRow + 3, 2).setValue(amount);
      btSheet.getRange(lastRow + 4, 1).setValue("Last Updated");
      btSheet.getRange(lastRow + 4, 2).setValue(new Date());
      return;
    }
    
    if (balanceRow !== -1) {
      const cell = btSheet.getRange(balanceRow, 2);
      const currentValue = parseFloat(String(cell.getValue()).replace(/[^0-9.\-]/g, "")) || 0;
      cell.setValue(currentValue + amount);
    }
    
  } catch (e) {
    console.error("updateCreditBalance error: " + e);
  }
}

function handleShowCredit(chatId) {
  const balance = getCreditCardBalance();
  
  if (balance === 0) {
    sendMessage(chatId, "No outstanding credit card balance. Nice!");
    return;
  }
  
  // Get this month's credit transactions
  const now = new Date();
  const currentMonth = now.getMonth();
  const currentYear = now.getFullYear();
  
  const sheet = SpreadsheetApp.openById(SPREADSHEET_ID).getSheetByName("RawBudget");
  const data = sheet.getDataRange().getValues();
  
  let monthlyCharges = 0;
  let monthlyPayments = 0;
  const transactions = [];
  
  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    const source = String(row[5]).toLowerCase();
    
    if (!source.includes("credit")) continue;
    
    const dateObj = parseDateStr(row[0]);
    if (!dateObj) continue;
    if (dateObj.getMonth() !== currentMonth || dateObj.getFullYear() !== currentYear) continue;
    
    const amount = Number(String(row[4]).replace(/[^0-9]/g, "")) || 0;
    const type = row[2];
    const desc = row[6];
    
    if (type === "Expense") {
      if (String(desc).toLowerCase().includes("credit payment")) {
        monthlyPayments += amount;
      } else {
        monthlyCharges += amount;
      }
    }
    
    transactions.push({ date: row[0], type, amount, desc });
  }
  
  let msg = `Credit Card Summary\n\n`;
  msg += `Outstanding Balance: ${formatNumber(balance)}\n`;
  msg += `This Month's Charges: ${formatNumber(monthlyCharges)}\n`;
  msg += `This Month's Payments: ${formatNumber(monthlyPayments)}\n`;
  
  if (transactions.length > 0) {
    msg += `\nRecent transactions:\n`;
    for (const t of transactions.slice(0, 5)) {
      msg += `- ${t.date}: ${formatNumber(t.amount)} (${t.desc})\n`;
    }
  }
  
  sendMessage(chatId, msg);
}

// =============================================
// --- MEDIA MESSAGE HANDLER (FIXED for queries) ---
// =============================================
function handleMediaMessage(chatId, fileId, mimeType) {
  let base64Data;
  try {
    const fileUrl = `https://api.telegram.org/bot${TELEGRAM_TOKEN}/getFile?file_id=${fileId}`;
    const fileResponse = UrlFetchApp.fetch(fileUrl, { muteHttpExceptions: true });
    const fileData = JSON.parse(fileResponse.getContentText());

    if (!fileData.ok || !fileData.result.file_path) {
      sendMessage(chatId, "Hmm, couldn't grab that file from Telegram. Mind trying again?");
      return;
    }

    const downloadUrl = `https://api.telegram.org/file/bot${TELEGRAM_TOKEN}/${fileData.result.file_path}`;
    const blob = UrlFetchApp.fetch(downloadUrl).getBlob();
    base64Data = Utilities.base64Encode(blob.getBytes());
  } catch (e) {
    console.error("Media download error: " + e);
    sendMessage(chatId, "Had trouble downloading that. Give it another shot?");
    return;
  }

  const now = new Date();
  const todayStr = Utilities.formatDate(now, Session.getScriptTimeZone(), "dd/MM/yyyy");
  const CATEGORIES = getCategories();
  const VALID_SOURCES = getValidSources();

  // FIXED: Clearer prompt with explicit query handling priority
  const prompt = `
    Listen to/watch this media and determine what the user wants.
    Today's date is ${todayStr}.

    STEP 1 - FIRST determine the PRIMARY INTENT:
    - Is the user ASKING A QUESTION about their finances? (e.g., "how much did I spend", "what's my balance", "show me my expenses")
    - Or is the user LOGGING a transaction? (e.g., "spent 50k on food", "bought coffee for 30k")

    STEP 2 - Return the appropriate JSON:

    IF THE USER IS ASKING A QUESTION (query intent):
    Return exactly: { "intent": "query", "question": "transcribed question here" }
    
    Examples of questions:
    - "How much have I spent this month?" → { "intent": "query", "question": "How much have I spent this month?" }
    - "What's my food budget looking like?" → { "intent": "query", "question": "What's my food budget looking like?" }
    - "Show me my expenses from last week" → { "intent": "query", "question": "Show me my expenses from last week" }

    IF THE USER IS LOGGING TRANSACTIONS:
    Return a JSON ARRAY of transaction objects (even for single transaction).
    Each object: { "intent": "log", "type": "Income" or "Expense", "category": one of [${CATEGORIES.join(", ")}], "amount": raw integer, "description": "short description", "date": "dd/MM/yyyy" or null, "time": "HH:mm:ss" or null, "source": one of [${VALID_SOURCES.join(", ")}] or null }

    CRITICAL: All dates MUST be in dd/MM/yyyy format. Day comes FIRST, then month, then year.
    Example: March 11, 2026 = "11/03/2026". NOT "03/11/2026".

    TRANSFER DETECTION: If the user says "transferred X from [Source A] to [Source B]", return TWO objects:
      1. { "intent": "log", "type": "Expense", "category": "Top-up", "amount": X, "source": "[Source A]", "description": "Transfer to [Source B]", ... }
      2. { "intent": "log", "type": "Income", "category": "Top-up", "amount": X, "source": "[Source B]", "description": "Transfer from [Source A]", ... }

    CREDIT CARD: If source is a credit card and description includes "payment" or "pay off" or "credit payment":
      - Type should be "Expense"
      - Category should be "Credit Payment"

    Amount rules: Strip currency symbols, thousand separators. "40k" = 40000. "Rp. 21.900" = 21900. "1.5jt" = 1500000.
    Time rules: ONLY return time if user gives explicit clock time. "lunch", "coffee" are NOT times.
    Source rules: Match to closest valid source. Null if not mentioned.
    Description rules: Fix typos, proper capitalization, no emojis.

    If no clear financial content detected, return []
  `;

  const result = callGeminiWithMedia(prompt, base64Data, mimeType);

  if (result.error) {
    sendMessage(chatId, result.error);
    return;
  }

  let parsed;
  try {
    parsed = JSON.parse(result.text);
  } catch (e) {
    console.error("JSON parse error: " + e + " | Raw: " + result.text);
    sendMessage(chatId, "Cookie got confused by that one. Try again or just type it out?");
    return;
  }

  // FIXED: Handle query intent BEFORE array conversion
  // Check if it's a direct query object (not an array)
  if (parsed && !Array.isArray(parsed) && parsed.intent === "query") {
    handleQuery(chatId, parsed.question);
    return;
  }

  // Convert to array if needed
  if (!Array.isArray(parsed)) {
    parsed = (parsed && Object.keys(parsed).length > 0) ? [parsed] : [];
  }

  // Check if first element is a query (in case AI returned array with query)
  if (parsed.length > 0 && parsed[0].intent === "query") {
    handleQuery(chatId, parsed[0].question);
    return;
  }

  if (parsed.length === 0) {
    sendMessage(chatId, "Didn't catch anything financial in there. Could you try again?");
    return;
  }

  // Process log transactions
  const sheet = SpreadsheetApp.openById(SPREADSHEET_ID).getSheetByName("RawBudget");
  const confirmations = [];
  const budgetNotes = [];

  for (const item of parsed) {
    if (!item.amount || item.intent === "query") continue;

    if (!CATEGORIES.includes(item.category)) {
      item.category = "Other";
    }

    const source = resolveSource(item.source);
    const usedDefault = !item.source;
    const isCredit = source.toLowerCase().includes("credit");

    const dateStr = ensureDDMMYYYY(item.date, now);
    const timeOnly = resolveTime(item.time, item.date, now, todayStr);

    sheet.appendRow([dateStr, timeOnly, item.type, item.category, item.amount, source, item.description]);

    // Update the Source table in BudgetTracker
    updateSourceAmount(source, item.type, item.amount);

    // Handle credit card tracking
    if (isCredit && item.type === "Expense") {
      const isCreditPayment = item.category === "Credit Payment" || 
                              String(item.description).toLowerCase().includes("credit payment");
      if (isCreditPayment) {
        // Paying off credit reduces balance
        updateCreditBalance(-item.amount);
      } else {
        // Charging to credit increases balance
        updateCreditBalance(item.amount);
      }
    }

    let conf = `${item.type} of ${formatNumber(item.amount)} for ${item.category} on ${dateStr}`;
    if (usedDefault) {
      conf += ` (source: ${source} by default)`;
    } else {
      conf += ` (source: ${source})`;
    }
    confirmations.push(conf);

    if (item.type === "Expense") {
      const status = getMonthlyStatus(item.category);
      if (status) {
        const pctUsed = Math.round((status.spent / status.limit) * 100);
        budgetNotes.push(`${item.category} Budget: ${formatNumber(status.spent)} of ${formatNumber(status.limit)} used (${pctUsed}%) - ${status.status}`);
      }
    }
  }

  if (confirmations.length === 0) {
    sendMessage(chatId, "Heard you, but couldn't pin down any amounts. Try again?");
    return;
  }

  let msg = buildConfirmation(confirmations, budgetNotes);
  sendMessage(chatId, msg);

  try {
    sortSheet(sheet);
  } catch (e) {
    console.error("Sort error (non-critical): " + e);
  }
}

// =============================================
// --- QUERY HANDLER ---
// =============================================
function handleQuery(chatId, text) {
  const rawSheet = SpreadsheetApp.openById(SPREADSHEET_ID).getSheetByName("RawBudget");
  const rawData = rawSheet.getDataRange().getValues();

  if (rawData.length <= 1) {
    sendMessage(chatId, "Nothing in the books yet! Log some transactions first and then ask away.");
    return;
  }

  const headers = rawData[0];
  const rows = rawData.slice(1);
  let csvContext = headers.join(",") + "\n";
  for (const row of rows) {
    csvContext += row.join(",") + "\n";
  }

  let limitsContext = "";
  let sourceContext = "";
  let creditContext = "";
  const btSheet = SpreadsheetApp.openById(SPREADSHEET_ID).getSheetByName("BudgetTracker");
  if (btSheet) {
    const btData = btSheet.getDataRange().getValues();

    let currentTable = null;
    const sourceRows = [];
    const limitsRows = [];

    for (let i = 0; i < btData.length; i++) {
      const firstCell = String(btData[i][0]).trim();

      if (firstCell === "Source") {
        currentTable = "source";
        continue;
      } else if (firstCell === "Limits") {
        currentTable = "limits";
        continue;
      } else if (firstCell === "Credit Card") {
        currentTable = "credit";
        continue;
      } else if (firstCell === "Custom Categories") {
        currentTable = "categories";
        continue;
      }

      if (firstCell === "Method" || firstCell === "Category" || firstCell === "Outstanding Balance") continue;

      if (!firstCell) {
        currentTable = null;
        continue;
      }

      if (currentTable === "source") {
        sourceRows.push(btData[i]);
      } else if (currentTable === "limits") {
        limitsRows.push(btData[i]);
      }
    }

    if (sourceRows.length > 0) {
      sourceContext = "\nMoney sources (Method, Amount, Description):\n";
      sourceContext += "Method,Amount,Description\n";
      for (const row of sourceRows) {
        sourceContext += row.join(",") + "\n";
      }
    }

    if (limitsRows.length > 0) {
      limitsContext = "\nMonthly budget limits (Category, Amount, Description):\n";
      limitsContext += "Category,Amount,Description\n";
      for (const row of limitsRows) {
        limitsContext += row.join(",") + "\n";
      }
    }

    const creditBalance = getCreditCardBalance();
    if (creditBalance > 0) {
      creditContext = `\nCredit Card Outstanding Balance: ${creditBalance}\n`;
    }
  }

  const now = new Date();
  const todayStr = Utilities.formatDate(now, Session.getScriptTimeZone(), "dd/MM/yyyy");
  const dayOfWeek = Utilities.formatDate(now, Session.getScriptTimeZone(), "EEEE");

  const prompt = `
    You are Cookie, a cheerful and concise personal budget assistant on Telegram. Keep responses short and to the point — just the numbers and a brief note if needed. No emojis. No bullet points or numbered lists — keep it conversational. Be friendly but don't ramble.

    Today is ${dayOfWeek}, ${todayStr}.
    Date format is dd/MM/yyyy (day/month/year).

    User's transaction data (columns: Date, Time, Type, Category, Amount, Source, Description):
    ${csvContext}
    ${sourceContext}
    ${limitsContext}
    ${creditContext}

    The user asks: "${text}"

    Instructions:
    - Answer accurately using the data above. Perform calculations as needed.
    - Amounts are raw numbers — format with period thousand separators when displaying (e.g. 150000 = 150.000). No currency symbols.
    - When asked about remaining budget, calculate: limit - total spent this month in that category.
    - Sum all limit rows for the same category to get the total category limit.
    - Limits amounts may be formatted like "1,500,000" — strip formatting to get raw numbers for math.
    - For pacing, consider what day of the month it is vs total days in the month.
    - The Source table shows the user's current balances across different payment methods.
    - Keep answers SHORT. 1-3 sentences max for simple questions. Only elaborate if the question is complex.
    - If data is insufficient, say so honestly.
    - For predictions, base on patterns and state it's an estimate.
    - Never use emojis.
    - For credit card questions, the Outstanding Balance shows what's owed.
  `;

  const result = callGemini(prompt, false);

  if (result.error) {
    sendMessage(chatId, result.error);
    return;
  }

  sendMessage(chatId, result.text);
}

// =============================================
// --- FINANCIAL MESSAGE PROCESSING ---
// =============================================
function processFinancialMessage(chatId, text) {
  const now = new Date();
  const todayStr = Utilities.formatDate(now, Session.getScriptTimeZone(), "dd/MM/yyyy");
  const CATEGORIES = getCategories();
  const VALID_SOURCES = getValidSources();

  const prompt = `
    Extract financial data from this text: "${text}"
    Today's date is ${todayStr}.
    CRITICAL: All dates MUST be in dd/MM/yyyy format. Day comes FIRST, then month, then year.
    Example: March 11, 2026 = "11/03/2026". NOT "03/11/2026".

    The message may contain MULTIPLE transactions. Return a JSON ARRAY of objects.
    Even if there is only one transaction, wrap it in an array.

    TRANSFER DETECTION: If the user says something like "transferred X from [Source A] to [Source B]" or "moved X from A to B" or "topup X from A to B", return TWO objects in the array:
      1. { "type": "Expense", "category": "Top-up", "amount": X, "source": "[Source A]", "description": "Transfer to [Source B]", "date": ..., "time": ... }
      2. { "type": "Income", "category": "Top-up", "amount": X, "source": "[Source B]", "description": "Transfer from [Source A]", "date": ..., "time": ... }

    CREDIT CARD PAYMENT: If the text mentions paying credit card bill, credit payment, or paying off credit:
      - Type: "Expense"
      - Category: "Credit Payment"
      - Source: the card being paid (e.g., "BCA Credit Card") or the payment source
      - Description: should include "Credit Payment"

    Each object:
    - "type": strictly "Income" or "Expense"
    - "category": one of [${CATEGORIES.join(", ")}], pick closest match
    - "amount": raw integer. Strip currency symbols, separators, and shorthand. "40k" = 40000. "Rp. 21.900" = 21900. "1.5jt" = 1500000. "2jt" = 2000000.
    - "description": short description. Fix any typos or spelling mistakes. Use proper capitalization (capitalize first letter of each word). No emojis.
    - "date": "dd/MM/yyyy" or null (resolve relative dates relative to ${todayStr})
    - "time": "HH:mm:ss" or null.
      ONLY return a time if the user gives an EXPLICIT clock time or temporal phrase like "at 3pm", "around 10am", "this morning", "this evening".
      DO NOT infer time from what was purchased. "lunch", "dinner", "breakfast", "coffee" describe WHAT was bought, NOT when.
      If no explicit time or temporal phrase is stated, return null. The system handles defaults.
    - "source": one of [${VALID_SOURCES.join(", ")}] or null.
      The source is the payment method. If the user mentions a payment method (e.g., "paid with GoPay", "from BCA", "cash", "ShopeePay", "credit", "credit card"), match to the closest valid source.
      If no source is mentioned, return null (the system will default to ${DEFAULT_SOURCE}).

    If no clear financial data, return an empty array []
  `;

  const result = callGemini(prompt, true);

  if (result.error) {
    sendMessage(chatId, result.error);
    return;
  }

  try {
    let parsed = JSON.parse(result.text);

    if (!Array.isArray(parsed)) {
      parsed = (parsed && Object.keys(parsed).length > 0) ? [parsed] : [];
    }

    if (parsed.length === 0) {
      sendMessage(chatId, "Cookie couldn't find any financial data in that. Try something like: 'spent 50k on food'.");
      return;
    }

    const sheet = SpreadsheetApp.openById(SPREADSHEET_ID).getSheetByName("RawBudget");
    const confirmations = [];
    const budgetNotes = [];

    for (const item of parsed) {
      if (!item.amount) continue;

      if (!CATEGORIES.includes(item.category)) {
        item.category = "Other";
      }

      const source = resolveSource(item.source);
      const usedDefault = !item.source;
      const isCredit = source.toLowerCase().includes("credit");

      const dateStr = ensureDDMMYYYY(item.date, now);
      const timeOnly = resolveTime(item.time, item.date, now, todayStr);

      sheet.appendRow([dateStr, timeOnly, item.type, item.category, item.amount, source, item.description]);

      // Update the Source table in BudgetTracker
      updateSourceAmount(source, item.type, item.amount);

      // Handle credit card tracking
      if (isCredit && item.type === "Expense") {
        const isCreditPayment = item.category === "Credit Payment" || 
                                String(item.description).toLowerCase().includes("credit payment");
        if (isCreditPayment) {
          // Paying off credit reduces balance
          updateCreditBalance(-item.amount);
        } else {
          // Charging to credit increases balance
          updateCreditBalance(item.amount);
        }
      }

      let conf = `${item.type} of ${formatNumber(item.amount)} for ${item.category} on ${dateStr}`;
      if (usedDefault) {
        conf += ` (source: ${source} by default)`;
      } else {
        conf += ` (source: ${source})`;
      }
      confirmations.push(conf);

      if (item.type === "Expense") {
        const status = getMonthlyStatus(item.category);
        if (status) {
          const pctUsed = Math.round((status.spent / status.limit) * 100);
          budgetNotes.push(`${item.category} Budget: ${formatNumber(status.spent)} of ${formatNumber(status.limit)} used (${pctUsed}%) - ${status.status}`);
        }
      }
    }

    if (confirmations.length === 0) {
      sendMessage(chatId, "Got the message, but couldn't extract any amounts. Could you include a number?");
      return;
    }

    let msg = buildConfirmation(confirmations, budgetNotes);
    sendMessage(chatId, msg);

    try {
      sortSheet(sheet);
    } catch (e) {
      console.error("Sort error (non-critical): " + e);
    }

  } catch (e) {
    console.error("Parse error: " + e);
    sendMessage(chatId, "Something went wrong on Cookie's end. Try that again?");
  }
}

// =============================================
// --- WEEKLY SUMMARY (trigger: every Sunday) ---
// =============================================
function weeklySummary() {
  const sheet = SpreadsheetApp.openById(SPREADSHEET_ID).getSheetByName("RawBudget");
  const data = sheet.getDataRange().getValues();

  if (data.length <= 1) return;

  const now = new Date();
  const weekAgo = new Date(now);
  weekAgo.setDate(weekAgo.getDate() - 7);

  const rows = data.slice(1);
  const weekRows = rows.filter(row => {
    const dateObj = parseDateStr(row[0]);
    return dateObj && dateObj >= weekAgo && dateObj <= now;
  });

  if (weekRows.length === 0) {
    sendMessage(ADMIN_CHAT_ID, "Cookie's Weekly Report\n\nNothing logged this week. Either you're living off the grid or you forgot about me!");
    return;
  }

  let totalExpense = 0;
  let totalIncome = 0;
  const expenseByCategory = {};
  const incomeByCategory = {};

  for (const row of weekRows) {
    const type = row[2];
    const category = row[3];
    const amount = Number(String(row[4]).replace(/[^0-9]/g, "")) || 0;

    if (type === "Expense") {
      totalExpense += amount;
      expenseByCategory[category] = (expenseByCategory[category] || 0) + amount;
    } else if (type === "Income") {
      totalIncome += amount;
      incomeByCategory[category] = (incomeByCategory[category] || 0) + amount;
    }
  }

  const startStr = Utilities.formatDate(weekAgo, Session.getScriptTimeZone(), "dd/MM/yyyy");
  const endStr = Utilities.formatDate(now, Session.getScriptTimeZone(), "dd/MM/yyyy");

  let msg = `Cookie's Weekly Report (${startStr} - ${endStr})\n\n`;

  msg += `Total Spent: ${formatNumber(totalExpense)}\n`;
  const sortedExpenses = Object.entries(expenseByCategory).sort((a, b) => b[1] - a[1]);
  for (const [cat, amt] of sortedExpenses) {
    msg += `  - ${cat}: ${formatNumber(amt)}\n`;
  }

  if (totalIncome > 0) {
    msg += `\nTotal Earned: ${formatNumber(totalIncome)}\n`;
    const sortedIncome = Object.entries(incomeByCategory).sort((a, b) => b[1] - a[1]);
    for (const [cat, amt] of sortedIncome) {
      msg += `  - ${cat}: ${formatNumber(amt)}\n`;
    }
  } else {
    msg += `\nTotal Earned: 0\n`;
  }

  const net = totalIncome - totalExpense;
  const netSign = net >= 0 ? "+" : "-";
  msg += `\nNet: ${netSign}${formatNumber(Math.abs(net))}`;

  // Add credit card balance
  const creditBalance = getCreditCardBalance();
  if (creditBalance > 0) {
    msg += `\n\nCredit Card Outstanding: ${formatNumber(creditBalance)}`;
  }

  if (net < 0 && totalExpense > 0) {
    msg += `\n\nYou spent more than you earned this week. Keep an eye on it!`;
  } else if (net > 0) {
    msg += `\n\nNice one - you came out positive this week.`;
  }

  sendMessage(ADMIN_CHAT_ID, msg);
}

// =============================================
// --- UTILITIES ---
// =============================================

// Parse amount from text (handles k, jt, etc.)
function parseAmount(text) {
  if (!text) return 0;
  
  let str = String(text).toLowerCase().trim();
  str = str.replace(/[rp.,\s]/g, "");
  
  let multiplier = 1;
  if (str.includes("jt") || str.includes("juta")) {
    multiplier = 1000000;
    str = str.replace(/jt|juta/g, "");
  } else if (str.includes("k") || str.includes("rb") || str.includes("ribu")) {
    multiplier = 1000;
    str = str.replace(/k|rb|ribu/g, "");
  }
  
  const num = parseFloat(str) || 0;
  return Math.round(num * multiplier);
}

// Format number with period thousand separators
function formatNumber(num) {
  return Math.round(num).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ".");
}

// Resolve source: validate against VALID_SOURCES, default to DEFAULT_SOURCE
function resolveSource(parsedSource) {
  if (!parsedSource) return DEFAULT_SOURCE;

  const VALID_SOURCES = getValidSources();
  const normalized = String(parsedSource).trim();
  
  for (const vs of VALID_SOURCES) {
    if (vs.toLowerCase() === normalized.toLowerCase()) {
      return vs;
    }
  }

  // Fuzzy match
  for (const vs of VALID_SOURCES) {
    if (vs.toLowerCase().includes(normalized.toLowerCase()) || normalized.toLowerCase().includes(vs.toLowerCase())) {
      return vs;
    }
  }

  return DEFAULT_SOURCE;
}

// Update the Source table in BudgetTracker
function updateSourceAmount(source, type, amount) {
  try {
    const btSheet = SpreadsheetApp.openById(SPREADSHEET_ID).getSheetByName("BudgetTracker");
    if (!btSheet) return;

    const data = btSheet.getDataRange().getValues();

    let inSourceTable = false;
    for (let i = 0; i < data.length; i++) {
      const firstCell = String(data[i][0]).trim();

      if (firstCell === "Source") {
        inSourceTable = true;
        continue;
      }

      if (firstCell === "Limits" || firstCell === "Custom Categories" || firstCell === "Credit Card" || (inSourceTable && !firstCell)) {
        break;
      }

      if (firstCell === "Method") continue;

      if (inSourceTable && firstCell === source) {
        const cell = btSheet.getRange(i + 1, 2);
        const formula = cell.getFormula();
        const displayValue = cell.getDisplayValue();

        let newFormula;
        if (formula) {
          if (type === "Expense") {
            newFormula = formula + " - " + amount;
          } else {
            newFormula = formula + " + " + amount;
          }
        } else {
          const rawNum = String(displayValue).replace(/[^0-9.\-]/g, "");
          const numericVal = parseFloat(rawNum) || 0;
          if (type === "Expense") {
            newFormula = "=" + numericVal + " - " + amount;
          } else {
            newFormula = "=" + numericVal + " + " + amount;
          }
        }

        cell.setFormula(newFormula);
        return;
      }
    }
  } catch (e) {
    console.error("updateSourceAmount error: " + e);
  }
}

// Build confirmation message
function buildConfirmation(confirmations, budgetNotes) {
  let msg;
  if (confirmations.length === 1) {
    msg = `Logged: ${confirmations[0]}.`;
  } else {
    msg = `Logged ${confirmations.length} transactions:\n`;
    for (let i = 0; i < confirmations.length; i++) {
      msg += `${i + 1}. ${confirmations[i]}\n`;
    }
  }

  if (budgetNotes.length > 0) {
    msg += "\n\n";
    for (const note of budgetNotes) {
      msg += `${note}\n`;
    }
  }

  return msg.trim();
}

// Get monthly spending vs limit for a category
function getMonthlyStatus(category) {
  const now = new Date();
  const currentMonth = now.getMonth();
  const currentYear = now.getFullYear();

  const rawSheet = SpreadsheetApp.openById(SPREADSHEET_ID).getSheetByName("RawBudget");
  const rawData = rawSheet.getDataRange().getValues();
  let spent = 0;

  for (let i = 1; i < rawData.length; i++) {
    const row = rawData[i];
    const dateObj = parseDateStr(row[0]);
    if (!dateObj) continue;
    if (dateObj.getMonth() === currentMonth && dateObj.getFullYear() === currentYear
        && row[2] === "Expense"
        && row[3] === category)
    {
      spent += Number(String(row[4]).replace(/[^0-9]/g, "")) || 0;
    }
  }

  const btSheet = SpreadsheetApp.openById(SPREADSHEET_ID).getSheetByName("BudgetTracker");
  if (!btSheet) return null;

  const btData = btSheet.getDataRange().getValues();
  let totalLimit = 0;
  let hasLimit = false;
  let inLimitsTable = false;

  for (let i = 0; i < btData.length; i++) {
    const firstCell = String(btData[i][0]).trim();

    if (firstCell === "Limits") {
      inLimitsTable = true;
      continue;
    }

    if (inLimitsTable && firstCell === "Category") continue;

    if (inLimitsTable && (!firstCell || firstCell === "Custom Categories" || firstCell === "Credit Card")) break;

    if (inLimitsTable) {
      const limCategory = firstCell;
      if (limCategory === category) {
        let amt = String(btData[i][1]).replace(/[^0-9]/g, "");
        totalLimit += parseInt(amt, 10) || 0;
        hasLimit = true;
      }
    }
  }

  if (!hasLimit) return null;

  const pct = totalLimit > 0 ? (spent / totalLimit) * 100 : 0;

  const daysInMonth = new Date(currentYear, currentMonth + 1, 0).getDate();
  const dayOfMonth = now.getDate();
  const expectedPct = (dayOfMonth / daysInMonth) * 100;

  let status;
  if (pct > 100) {
    status = "Over";
  } else if (pct > expectedPct + 10) {
    status = "Behind";
  } else if (pct < expectedPct - 10) {
    status = "Ahead";
  } else {
    status = "On Track";
  }

  return {
    spent: spent,
    limit: totalLimit,
    status: status
  };
}

// Resolve time: today with no time = current time, other day = 00:00:00
function resolveTime(parsedTime, parsedDate, now, todayStr) {
  if (parsedTime) return parsedTime;

  if (parsedDate) {
    const resolvedDate = ensureDDMMYYYY(parsedDate, now);
    if (resolvedDate !== todayStr) {
      return "00:00:00";
    }
  }

  return Utilities.formatDate(now, Session.getScriptTimeZone(), "HH:mm:ss");
}

// Validate and fix date format — always returns dd/MM/yyyy string
function ensureDDMMYYYY(dateStr, fallback) {
  if (!dateStr) {
    return Utilities.formatDate(fallback, Session.getScriptTimeZone(), "dd/MM/yyyy");
  }

  if (dateStr instanceof Date) {
    return Utilities.formatDate(dateStr, Session.getScriptTimeZone(), "dd/MM/yyyy");
  }

  if (typeof dateStr !== "string") {
    return Utilities.formatDate(fallback, Session.getScriptTimeZone(), "dd/MM/yyyy");
  }

  dateStr = dateStr.trim().split(" ")[0];

  const parts = dateStr.split("/");
  if (parts.length !== 3) {
    return Utilities.formatDate(fallback, Session.getScriptTimeZone(), "dd/MM/yyyy");
  }

  let day = parseInt(parts[0], 10);
  let month = parseInt(parts[1], 10);
  const year = parseInt(parts[2], 10);

  if (month > 12 && day <= 12) {
    const temp = day;
    day = month;
    month = temp;
  }

  if (day < 1 || day > 31 || month < 1 || month > 12 || year < 2020) {
    return Utilities.formatDate(fallback, Session.getScriptTimeZone(), "dd/MM/yyyy");
  }

  return String(day).padStart(2, "0") + "/" + String(month).padStart(2, "0") + "/" + year;
}

// Parse date string to Date object
function parseDateStr(dateStr) {
  if (dateStr instanceof Date) return dateStr;

  if (!dateStr || typeof dateStr !== "string") return null;
  const parts = dateStr.trim().split(" ")[0].split("/");
  if (parts.length !== 3) return null;
  const day = parseInt(parts[0], 10);
  const month = parseInt(parts[1], 10) - 1;
  const year = parseInt(parts[2], 10);
  if (isNaN(day) || isNaN(month) || isNaN(year)) return null;
  return new Date(year, month, day);
}

// Sort sheet by Date desc, then Time desc
function sortSheet(sheet) {
  const lastRow = sheet.getLastRow();
  if (lastRow <= 2) return;

  const numCols = 7;
  const range = sheet.getRange(2, 1, lastRow - 1, numCols);
  const values = range.getValues();

  values.sort((a, b) => {
    const dateA = toTimestamp(a[0]);
    const dateB = toTimestamp(b[0]);

    if (dateA !== dateB) return dateB - dateA;

    const timeA = String(a[1] || "00:00:00");
    const timeB = String(b[1] || "00:00:00");
    return timeB.localeCompare(timeA);
  });

  range.setValues(values);
}

// Convert date cell to sortable timestamp
function toTimestamp(cell) {
  if (cell instanceof Date) return cell.getTime();

  if (typeof cell === "string") {
    const parts = cell.trim().split(" ")[0].split("/");
    if (parts.length === 3) {
      const d = new Date(parseInt(parts[2]), parseInt(parts[1]) - 1, parseInt(parts[0]));
      if (!isNaN(d.getTime())) return d.getTime();
    }
  }

  return 0;
}

// =============================================
// --- CORE GEMINI CALLERS ---
// =============================================

function callGemini(prompt, jsonMode) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${GEMINI_API_KEY}`;

  const payload = { contents: [{ parts: [{ text: prompt }] }] };
  if (jsonMode) {
    payload.generationConfig = { responseMimeType: "application/json" };
  }

  const options = {
    method: "post",
    contentType: "application/json",
    payload: JSON.stringify(payload),
    muteHttpExceptions: true,
  };

  return parseGeminiResponse(UrlFetchApp.fetch(url, options));
}

function callGeminiWithMedia(prompt, base64Data, mimeType) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${GEMINI_API_KEY}`;

  const payload = {
    contents: [{
      parts: [
        { inline_data: { mime_type: mimeType, data: base64Data } },
        { text: prompt }
      ]
    }],
    generationConfig: { responseMimeType: "application/json" },
  };

  const options = {
    method: "post",
    contentType: "application/json",
    payload: JSON.stringify(payload),
    muteHttpExceptions: true,
  };

  return parseGeminiResponse(UrlFetchApp.fetch(url, options));
}

function parseGeminiResponse(response) {
  const statusCode = response.getResponseCode();

  if (statusCode === 429) {
    const now = new Date();
    const resetTime = new Date(now.toLocaleDateString("en-US", { timeZone: "America/Los_Angeles" }));
    resetTime.setDate(resetTime.getDate() + 1);

    const ptNow = new Date(now.toLocaleString("en-US", { timeZone: "America/Los_Angeles" }));
    const hoursLeft = Math.ceil((resetTime.getTime() - ptNow.getTime()) / (1000 * 60 * 60));

    const resetStr = Utilities.formatDate(resetTime, "America/Los_Angeles", "dd/MM/yyyy HH:mm");

    return {
      error: `Cookie's hit the API limit. The free tier resets at midnight Pacific Time (~${hoursLeft}h from now, ${resetStr} PT). Try again after that.`
    };
  }

  try {
    const json = JSON.parse(response.getContentText());

    if (json.error) {
      const msg = json.error.message || "Unknown API error";
      console.error("Gemini API Error: " + msg);
      return { error: `Gemini API error: ${msg}` };
    }

    const outputText = json.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!outputText) {
      console.error("Gemini returned empty content.");
      return { error: "Cookie got an empty response from the AI. Try again?" };
    }

    return { text: outputText };
  } catch (e) {
    console.error("Response parsing error: " + e);
    return { error: `Something broke on Cookie's end: ${e.message}` };
  }
}

// --- TELEGRAM HELPERS ---
function sendMessage(chatId, text) {
  const url = `https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`;
  const payload = { chat_id: chatId, text: text };
  const options = {
    method: "post",
    contentType: "application/json",
    payload: JSON.stringify(payload),
  };
  UrlFetchApp.fetch(url, options);
}

// --- SETUP ---
function setWebhook() {
  const url = `https://api.telegram.org/bot${TELEGRAM_TOKEN}/setWebhook?url=${WEBAPP_URL}&drop_pending_updates=true`;
  const response = UrlFetchApp.fetch(url);
  console.log(response.getContentText());
}

function deleteWebhook() {
  const url = `https://api.telegram.org/bot${TELEGRAM_TOKEN}/deleteWebhook?drop_pending_updates=true`;
  const response = UrlFetchApp.fetch(url);
  console.log(response.getContentText());
}
