import * as FileSystem from 'expo-file-system';

const logFilePath = FileSystem.documentDirectory + 'mobile-sync.log';

async function writeLog(level: string, message: string, data?: any) {
  try {
    const timestamp = new Date().toISOString();
    const dataStr = data ? JSON.stringify(data, null, 2) : '';
    const logLine = \n[] []  ;
    
    if (level === 'ERROR') {
      console.error([SYNC] , data || '');
    } else {
      console.log([SYNC] , data || '');
    }

    const fileInfo = await FileSystem.getInfoAsync(logFilePath);
    if (!fileInfo.exists) {
      await FileSystem.writeAsStringAsync(logFilePath, logLine);
    } else {
      const currentContent = await FileSystem.readAsStringAsync(logFilePath);
      await FileSystem.writeAsStringAsync(logFilePath, currentContent + logLine);
    }
  } catch (error) {
    console.error('Failed to write sync log', error);
  }
}

export const syncLogger = {
  info: (message: string, data?: any) => writeLog('INFO', message, data),
  error: (message: string, data?: any) => writeLog('ERROR', message, data),
  debug: (message: string, data?: any) => writeLog('DEBUG', message, data)
};
