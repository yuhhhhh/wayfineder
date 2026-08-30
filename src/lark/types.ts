export interface InboundMessage {
  eventId: string;
  messageId: string;
  chatId: string;
  chatType: "p2p" | "group";
  senderOpenId: string;
  text: string;
  mentionedBot: boolean;
  createdAt: Date;
}

export interface MessageTransport {
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  onMessage(handler: (message: InboundMessage) => void | Promise<void>): () => void;
  sendText(chatId: string, text: string, replyToMessageId?: string): Promise<void>;
  isConnected(): boolean;
}
