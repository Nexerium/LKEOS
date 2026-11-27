# ЛКЭОС

**Сдай лабораторную, проверь оценку и узнай, где следующая пара.** ЛКЭОС объединяет ЭОС и ЛКС для студентов Калужского филиала МГТУ им. Н. Э. Баумана.

[![Скачать для Windows x64](docs/images/download.svg)](https://github.com/Nexerium/LKEOS/releases/download/v1.0/LKEOS-1.0-win-x64.exe)
[![Скачать для iPhone](docs/images/iphone.svg)](https://github.com/Nexerium/LKEOS/releases/download/v1.0/LKEOS-1.0-iphone.ipa)

На **Windows x64** открой EXE и войди через МГТУ. На **iPhone с iOS 17 или новее** перед установкой подпиши IPA для своего устройства. [Подробнее об iPhone](ios/README.md)

![Пять недавних работ и календарь в тёмной теме](docs/images/overview.png)

### Что внутри

* **Работы и курсы.** Открой лабораторную прямо с главной, скачай методичку и прикрепи отчёт. Галочкой можно отметить работу для себя.
* **Расписание.** Пары ИУК6-51 по подгруппам. Числитель и знаменатель видны рядом.
* **Оценки.** Успеваемость по неделям и результаты сессии по семестрам из ЛКС.
* **Профиль.** Несколько аккаунтов, автовход и две темы. Пароль можно сохранить в Диспетчере учётных данных Windows или в Связке ключей iPhone.

<details>
<summary><b>Как выглядит сдача лабораторной</b></summary>

![Карточка работы в тёмной теме с оценкой, методичкой и загрузкой отчёта](docs/images/lab.png)

</details>

<details>
<summary><b>Собрать Windows-версию из исходников</b></summary>

Понадобятся Windows, .NET 8 SDK и доступ к NuGet. Выполни команду в корне репозитория.

```powershell
dotnet publish KalugaCampus.csproj -c Release -r win-x64 --self-contained true -p:PublishSingleFile=true -p:IncludeNativeLibrariesForSelfExtract=true -p:EnableCompressionInSingleFile=true -o publish
```

Запусти `publish/KalugaCampus.exe`. Для окна входа нужен [WebView2 Runtime](https://developer.microsoft.com/microsoft-edge/webview2/).

</details>

### Помощь и поддержка проекта

[![Поддержать проект](docs/images/support.svg)](https://t.me/sexamine)

Если нужна помощь с приложением, [напиши автору в Telegram](https://t.me/sexamine).

Независимый студенческий проект. Скриншоты сделаны на тестовых данных.
