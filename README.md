# ЛКЭОС

**Сдай лабораторную, проверь оценку и узнай, где следующая пара.** ЛКЭОС объединяет ЭОС и ЛКС для студентов Калужского филиала МГТУ им. Н. Э. Баумана.

[![Скачать для Windows x64](docs/images/download.svg)](https://github.com/Nexerium/LKEOS/releases/download/v1.0/LKEOS-1.0-win-x64.exe)

Открой EXE и войди с учётной записью МГТУ. [Что вошло в версию 1.0](https://github.com/Nexerium/LKEOS/releases/tag/v1.0)

![Пять недавних работ и календарь в тёмной теме](docs/images/overview.png)

### Что внутри

* **Работы и курсы.** Открой лабораторную прямо с главной, скачай методичку и прикрепи отчёт. Галочкой можно отметить работу для себя.
* **Расписание.** Пары ИУК6-51 по подгруппам. Числитель и знаменатель видны рядом.
* **Оценки.** Успеваемость по неделям и результаты сессии по семестрам из ЛКС.
* **Профиль.** Несколько аккаунтов, автовход и две темы. Пароль можно сохранить в Диспетчере учётных данных Windows.

<details>
<summary><b>Как выглядит сдача лабораторной</b></summary>

![Карточка работы в тёмной теме с оценкой, методичкой и загрузкой отчёта](docs/images/lab.png)

</details>

<details>
<summary><b>Собрать из исходников</b></summary>

Понадобятся Windows, .NET 8 SDK и доступ к NuGet. Выполни команду в корне репозитория.

```powershell
dotnet publish KalugaCampus.csproj -c Release -r win-x64 --self-contained true -p:PublishSingleFile=true -p:IncludeNativeLibrariesForSelfExtract=true -p:EnableCompressionInSingleFile=true -o publish
```

Запусти `publish/KalugaCampus.exe`. Для окна входа нужен [WebView2 Runtime](https://developer.microsoft.com/microsoft-edge/webview2/).

</details>

### Помощь и поддержка проекта

Есть вопрос или хочешь поддержать ЛКЭОС? [Напиши автору в Telegram](https://t.me/sexamine).

Независимый студенческий проект. Скриншоты сделаны на тестовых данных.
